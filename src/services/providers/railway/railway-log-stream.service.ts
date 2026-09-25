import { createClient, type Client } from "graphql-ws";
import WebSocket from "ws";
import { processIncomingLog } from "../../logs/log-grouper.service";
import { persistGroupedLog } from "../../logs/log-ingestion.service";

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
            persistGroupedLog(project.id, "railway", groupedLog).catch((err) =>
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
