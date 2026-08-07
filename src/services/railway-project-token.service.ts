// Accès à l'API GraphQL publique de Railway avec un Project Token (header "Project-Access-Token").
// Solution retenue temporairement : le flux OAuth "Login with Railway" produit un access_token
// valide (vérifié via /oauth/me) mais systématiquement rejeté par /graphql/v2 ("Not Authorized").
// Le Project Token, lui, fonctionne de façon fiable sur ce même endpoint.

const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";

async function callRailwayApi<T>(projectToken: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Project-Access-Token": projectToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as { data?: T; errors?: unknown };

  if (!response.ok || json.errors) {
    throw new Error(`Erreur API Railway : ${JSON.stringify(json.errors ?? json)}`);
  }

  return json.data as T;
}

const DEPLOYMENTS_QUERY = `
  query Deployments($serviceId: String!, $environmentId: String!) {
    deployments(
      input: { serviceId: $serviceId, environmentId: $environmentId }
      first: 1
    ) {
      edges {
        node {
          id
          status
          createdAt
        }
      }
    }
  }
`;

const DEPLOYMENT_LOGS_QUERY = `
  query DeploymentLogs($deploymentId: String!) {
    deploymentLogs(deploymentId: $deploymentId, limit: 50) {
      timestamp
      message
      severity
    }
  }
`;

export type RailwayLogEntry = {
  timestamp: string;
  message: string;
  severity: string;
};

// Récupère les logs du dernier déploiement d'un service/environnement, avec un Project Token.
export async function fetchLatestDeploymentLogsWithProjectToken(
  projectToken: string,
  params: { serviceId: string; environmentId: string }
): Promise<RailwayLogEntry[]> {
  const deploymentsData = await callRailwayApi<{
    deployments: { edges: { node: { id: string; status: string; createdAt: string } }[] };
  }>(projectToken, DEPLOYMENTS_QUERY, params);

  const latestDeployment = deploymentsData.deployments.edges[0]?.node;

  if (!latestDeployment) {
    return [];
  }

  const logsData = await callRailwayApi<{ deploymentLogs: RailwayLogEntry[] }>(
    projectToken,
    DEPLOYMENT_LOGS_QUERY,
    { deploymentId: latestDeployment.id }
  );

  return logsData.deploymentLogs;
}
