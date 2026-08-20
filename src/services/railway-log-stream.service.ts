// Streaming temps réel des logs de déploiement Railway, via subscription GraphQL WebSocket.
// Détails du protocole (non documentés publiquement par Railway, déduits du code source
// officiel du CLI railwayapp/cli) :
//   - endpoint : wss://backboard.railway.com/graphql/v2
//   - sous-protocole : "graphql-transport-ws" (lib graphql-ws)
//   - authentification : header HTTP "project-access-token" sur la requête d'upgrade WS
//   - subscription : deploymentLogs(deploymentId: $deploymentId, filter: $filter, limit: $limit)

import { createClient, type Client } from "graphql-ws";
import WebSocket from "ws";
import { prisma } from "../lib/prisma";
import { processIncomingLog, type GroupedLog } from "./log-grouper.service";
import { triageLog } from "./log-triage.service";

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

// Récupère l'ID du dernier déploiement d'un service/environnement (nécessaire pour ouvrir
// une subscription, qui se fait par déploiement et non par service directement).
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

// Enregistre en base un log déjà regroupé/classifié (voir log-grouper.service.ts). Pour
// un log "critical" ou "warning", déclenche ensuite le triage par l'IA locale en tâche de
// fond (voir triageIncidentIfNeeded) — sans attendre sa réponse, pour ne jamais ralentir
// le flux de logs entrant. Exportée pour être testable isolément (voir
// scripts/test-log-ingestion.ts), sans dépendre d'une connexion Railway réelle.
export async function persistGroupedLog(projectId: string, log: GroupedLog) {
  const entry = await prisma.logEntry.create({
    data: {
      projectId,
      rawMessage: log.rawMessage,
      level: log.level,
      category: log.category,
      source: "railway",
      externalTimestamp: log.externalTimestamp,
    },
  });

  if (log.category === "critical" || log.category === "warning") {
    triageIncidentIfNeeded(entry.id, log).catch((err) =>
      console.error(`Erreur de triage IA du log ${entry.id} (projet ${projectId}) :`, err)
    );
  }
}

// Fait confirmer par l'IA locale qu'un log classé "critical"/"warning" par les règles est
// un vrai problème, et crée l'Alerte correspondante si oui. Un faux positif n'est pas
// supprimé : le LogEntry reste consultable dans l'historique, seule l'Alerte n'est pas créée.
async function triageIncidentIfNeeded(logEntryId: string, log: GroupedLog) {
  const triage = await triageLog({ level: log.level, category: log.category, message: log.rawMessage });

  await prisma.logEntry.update({
    where: { id: logEntryId },
    data: { aiSummary: triage.explanation },
  });

  if (triage.isRealIssue) {
    await prisma.alert.create({
      data: { logEntryId, explanation: triage.explanation },
    });
  }
}

// Un client WebSocket actif par projet Guardian AI surveillé.
const activeClients = new Map<string, Client>();

// Démarre (ou redémarre) le streaming des logs pour un projet Guardian AI donné.
export async function startLogStreamForProject(project: {
  id: string;
  railwayProjectToken: string;
  railwayServiceId: string;
  railwayEnvironmentId: string;
}) {
  // Évite les doublons de connexion si déjà en cours de streaming.
  stopLogStreamForProject(project.id);

  const deploymentId = await fetchLatestDeploymentId(project.railwayProjectToken, {
    serviceId: project.railwayServiceId,
    environmentId: project.railwayEnvironmentId,
  });

  if (!deploymentId) {
    console.error(`Projet ${project.id} : aucun déploiement actif trouvé, streaming non démarré.`);
    return;
  }

  // Le protocole "graphql-transport-ws" de Railway attend le token en header HTTP au
  // moment de l'upgrade WebSocket (pas dans connectionParams) — on fournit donc une
  // factory de WebSocket qui injecte ce header à la construction du socket.
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
