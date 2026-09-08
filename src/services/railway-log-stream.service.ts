import { createClient, type Client } from "graphql-ws";
import WebSocket from "ws";
import { prisma } from "../lib/prisma";
import { processIncomingLog, type GroupedLog } from "./log-grouper.service";
import { triageLog } from "./log-triage.service";
import { listProjectPhoneRecipients, listProjectRecipients } from "./project-access.service";
import { sendAlertEmail } from "./email.service";
import { sendAlertSms } from "./sms.service";
import { getSubscriptionForProject, tryConsumeSmsQuota } from "./subscription.service";

const RAILWAY_WS_URL = "wss://backboard.railway.com/graphql/v2";
const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";

const DEPLOYMENT_LOGS_SUBSCRIPTION = `
  subscription DeploymentLogs($deploymentId: String!, $filter: String, $limit: Int) {
    deploymentLogs(deploymentId: $deploymentId, filter: $filter, limit: $limit) {
      timestamp
      message
      severity
    }
  }
`;

const LATEST_DEPLOYMENT_QUERY = `
  query Deployments($serviceId: String!, $environmentId: String!) {
    deployments(
      input: { serviceId: $serviceId, environmentId: $environmentId }
      first: 1
    ) {
      edges {
        node {
          id
          status
        }
      }
    }
  }
`;

type LiveLog = {
  timestamp: string;
  message: string;
  severity: string;
};

async function fetchLatestDeploymentId(
  projectToken: string,
  params: { serviceId: string; environmentId: string }
): Promise<string | null> {
  const response = await fetch(RAILWAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Project-Access-Token": projectToken },
    body: JSON.stringify({ query: LATEST_DEPLOYMENT_QUERY, variables: params }),
  });

  const json = (await response.json()) as {
    data?: { deployments: { edges: { node: { id: string; status: string } }[] } };
    errors?: unknown;
  };

  if (!response.ok || json.errors || !json.data) {
    console.error("Impossible de récupérer le dernier déploiement :", json.errors ?? json);
    return null;
  }

  return json.data.deployments.edges[0]?.node.id ?? null;
}

export async function persistGroupedLog(projectId: string, log: GroupedLog) {
  const needsTriage = log.category === "critical" || log.category === "warning";

  const entry = await prisma.logEntry.create({
    data: {
      projectId,
      rawMessage: log.rawMessage,
      level: log.level,
      category: log.category,
      source: "railway",
      externalTimestamp: log.externalTimestamp,
      triageStatus: needsTriage ? "pending" : "none",
    },
  });

  if (needsTriage) {
    triageIncidentIfNeeded(projectId, entry.id, log).catch(async (err) => {
      console.error(`Erreur de triage IA du log ${entry.id} (projet ${projectId}) :`, err);

      await prisma.logEntry
        .update({ where: { id: entry.id }, data: { triageStatus: "done" } })
        .catch(() => {});
    });
  }
}

async function triageIncidentIfNeeded(projectId: string, logEntryId: string, log: GroupedLog) {
  await prisma.logEntry.update({ where: { id: logEntryId }, data: { triageStatus: "checking" } });

  const triage = await triageLog({ level: log.level, category: log.category, message: log.rawMessage });
  const wasReclassified = triage.finalCategory !== log.category;

  await prisma.logEntry.update({
    where: { id: logEntryId },
    data: {
      aiSummary: triage.explanation,
      category: triage.finalCategory,
      originalCategory: wasReclassified ? log.category : null,
      triageStatus: "done",
    },
  });

  if (triage.isRealIssue) {
    await prisma.alert.create({
      data: { logEntryId, explanation: triage.explanation },
    });

    notifyProjectRecipients(projectId, triage.finalCategory, triage.explanation).catch((err) =>
      console.error(`Erreur lors de l'envoi des emails d'alerte pour le projet ${projectId} :`, err)
    );
  }
}

async function notifyProjectRecipients(projectId: string, level: string, explanation: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, userId: true, organizationId: true, user: { select: { email: true } } },
  });
  if (!project) return;

  const [recipients, phoneRecipients] = await Promise.all([
    listProjectRecipients(projectId),
    listProjectPhoneRecipients(projectId),
  ]);

  const emailNotifications = recipients.map((to) =>
    sendAlertEmail({ to, projectName: project.name, level, explanation }).catch((err) =>
      console.error(`Erreur lors de l'envoi de l'email d'alerte à ${to} :`, err)
    )
  );

  // Le quota SMS se consomme une fois par alerte (pas une fois par destinataire) : soit
  // tous les destinataires reçoivent le SMS, soit aucun, pour ne pas épuiser le quota plus
  // vite sur un projet à plusieurs membres.
  let smsNotifications: Promise<void>[] = [];
  if (phoneRecipients.length > 0) {
    const subscription = await getSubscriptionForProject(project);
    const smsAllowed = subscription ? await tryConsumeSmsQuota(subscription, project.user.email) : true;

    if (smsAllowed) {
      smsNotifications = phoneRecipients.map((to) =>
        sendAlertSms({ to, projectName: project.name, level, explanation }).catch((err) =>
          console.error(`Erreur lors de l'envoi du SMS d'alerte à ${to} :`, err)
        )
      );
    }
  }

  await Promise.all([...emailNotifications, ...smsNotifications]);
}

const activeClients = new Map<string, Client>();

export async function startLogStreamForProject(project: {
  id: string;
  railwayProjectToken: string;
  railwayServiceId: string;
  railwayEnvironmentId: string;
}) {
  stopLogStreamForProject(project.id);

  const deploymentId = await fetchLatestDeploymentId(project.railwayProjectToken, {
    serviceId: project.railwayServiceId,
    environmentId: project.railwayEnvironmentId,
  });

  if (!deploymentId) {
    console.error(`Projet ${project.id} : aucun déploiement actif trouvé, streaming non démarré.`);
    return;
  }

  const webSocketImplWithAuth = class extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, {
        headers: { "project-access-token": project.railwayProjectToken },
      });
    }
  };

  const client = createClient({
    url: RAILWAY_WS_URL,
    webSocketImpl: webSocketImplWithAuth,
    lazy: false,
    retryAttempts: Infinity,
    on: {
      error: (err) => console.error(`Streaming Railway (projet ${project.id}) — erreur :`, err),
      closed: () => console.log(`Streaming Railway (projet ${project.id}) — connexion fermée.`),
    },
  });

  client.subscribe<{ deploymentLogs: LiveLog[] }>(
    {
      query: DEPLOYMENT_LOGS_SUBSCRIPTION,
      variables: { deploymentId, filter: "", limit: 50 },
    },
    {
      next: (result) => {
        const logs = result.data?.deploymentLogs ?? [];
        for (const log of logs) {
          processIncomingLog(project.id, log, (groupedLog) => {
            persistGroupedLog(project.id, groupedLog).catch((err) =>
              console.error(`Erreur d'enregistrement d'un log (projet ${project.id}) :`, err)
            );
          });
        }
      },
      error: (err) => console.error(`Streaming Railway (projet ${project.id}) — erreur de subscription :`, err),
      complete: () => console.log(`Streaming Railway (projet ${project.id}) — subscription terminée.`),
    }
  );

  activeClients.set(project.id, client);
  console.log(`Streaming Railway démarré pour le projet ${project.id} (déploiement ${deploymentId}).`);
}

export function stopLogStreamForProject(projectId: string) {
  const client = activeClients.get(projectId);
  if (client) {
    client.dispose();
    activeClients.delete(projectId);
  }
}

export function stopAllLogStreams() {
  for (const projectId of activeClients.keys()) {
    stopLogStreamForProject(projectId);
  }
}
