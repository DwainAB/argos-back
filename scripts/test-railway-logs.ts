// Script de test isolé : vérifie qu'on peut bien récupérer les logs d'un projet Railway
// via l'API GraphQL, avec un Project Token. À lancer avec : npx tsx scripts/test-railway-logs.ts

import "dotenv/config";

const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";

const token = process.env.RAILWAY_PROJECT_TOKEN;
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
const serviceId = process.env.RAILWAY_SERVICE_ID;

if (!token || !environmentId || !serviceId) {
  console.error(
    "Variables manquantes. Vérifie RAILWAY_PROJECT_TOKEN, RAILWAY_ENVIRONMENT_ID et RAILWAY_SERVICE_ID dans backend/.env"
  );
  process.exit(1);
}

// Requiert d'abord le déploiement actif du service, pour ensuite récupérer ses logs.
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
    deploymentLogs(deploymentId: $deploymentId, limit: 20) {
      timestamp
      message
      severity
    }
  }
`;

async function callRailwayApi<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Project-Access-Token": token as string,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (!response.ok || json.errors) {
    console.error("Erreur API Railway :", JSON.stringify(json.errors ?? json, null, 2));
    process.exit(1);
  }

  return json.data as T;
}

async function main() {
  console.log("Recherche du dernier déploiement...");

  const deploymentsData = await callRailwayApi<{
    deployments: { edges: { node: { id: string; status: string; createdAt: string } }[] };
  }>(DEPLOYMENTS_QUERY, { serviceId, environmentId });

  const latestDeployment = deploymentsData.deployments.edges[0]?.node;

  if (!latestDeployment) {
    console.error("Aucun déploiement trouvé pour ce service/environnement.");
    process.exit(1);
  }

  console.log(
    `Déploiement trouvé : ${latestDeployment.id} (statut: ${latestDeployment.status}, créé le ${latestDeployment.createdAt})`
  );
  console.log("Récupération des logs...\n");

  const logsData = await callRailwayApi<{
    deploymentLogs: { timestamp: string; message: string; severity: string }[];
  }>(DEPLOYMENT_LOGS_QUERY, { deploymentId: latestDeployment.id });

  if (logsData.deploymentLogs.length === 0) {
    console.log("Aucun log disponible pour ce déploiement pour l'instant.");
    return;
  }

  for (const log of logsData.deploymentLogs) {
    console.log(`[${log.timestamp}] (${log.severity}) ${log.message}`);
  }

  console.log(`\n${logsData.deploymentLogs.length} log(s) récupéré(s) avec succès.`);
}

main().catch((err) => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
