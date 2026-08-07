// Accès à l'API GraphQL publique de Railway, avec un access token OAuth ("Login with Railway").
// Contrairement au script scripts/test-railway-logs.ts (qui utilise un Project Token via le
// header "Project-Access-Token"), ici l'authentification se fait par Bearer token OAuth.

const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";

async function callRailwayApi<T>(accessToken: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as { data?: T; errors?: unknown };

  if (!response.ok || json.errors) {
    throw new Error(`Erreur API Railway : ${JSON.stringify(json.errors ?? json)}`);
  }

  return json.data as T;
}

// Requête de diagnostic simple, utilisée pour vérifier qu'un token OAuth est valide
// indépendamment des permissions sur "projects".
const ME_QUERY = `
  query Me {
    me {
      name
      email
    }
  }
`;

export async function fetchMe(accessToken: string) {
  return callRailwayApi<{ me: { name: string; email: string } }>(accessToken, ME_QUERY, {});
}

// "projects" est un champ racine du schéma Railway (pas un sous-champ de "me").
const PROJECTS_QUERY = `
  query Projects {
    projects {
      edges {
        node {
          id
          name
          services {
            edges {
              node {
                id
                name
              }
            }
          }
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

export type RailwayProjectSummary = {
  id: string;
  name: string;
  services: { id: string; name: string }[];
  environments: { id: string; name: string }[];
};

// Liste les projets accessibles par l'utilisateur ayant autorisé Guardian AI.
// Avec un token OAuth (scope project:viewer), ne renvoie que les projets explicitement
// sélectionnés par l'utilisateur lors de l'écran de consentement.
export async function fetchAccessibleProjects(accessToken: string): Promise<RailwayProjectSummary[]> {
  const data = await callRailwayApi<{
    projects: {
      edges: {
        node: {
          id: string;
          name: string;
          services: { edges: { node: { id: string; name: string } }[] };
          environments: { edges: { node: { id: string; name: string } }[] };
        };
      }[];
    };
  }>(accessToken, PROJECTS_QUERY, {});

  return data.projects.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
    services: node.services.edges.map((e) => e.node),
    environments: node.environments.edges.map((e) => e.node),
  }));
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

// Récupère les logs du dernier déploiement d'un service/environnement donné.
export async function fetchLatestDeploymentLogs(
  accessToken: string,
  params: { serviceId: string; environmentId: string }
): Promise<RailwayLogEntry[]> {
  const deploymentsData = await callRailwayApi<{
    deployments: { edges: { node: { id: string; status: string; createdAt: string } }[] };
  }>(accessToken, DEPLOYMENTS_QUERY, params);

  const latestDeployment = deploymentsData.deployments.edges[0]?.node;

  if (!latestDeployment) {
    return [];
  }

  const logsData = await callRailwayApi<{ deploymentLogs: RailwayLogEntry[] }>(accessToken, DEPLOYMENT_LOGS_QUERY, {
    deploymentId: latestDeployment.id,
  });

  return logsData.deploymentLogs;
}
