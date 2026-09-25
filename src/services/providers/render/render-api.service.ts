const RENDER_API_URL = "https://api.render.com/v1";

async function callRenderApi<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetch(`${RENDER_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Erreur API Render (${response.status}) : ${body}`);
  }

  return response.json() as Promise<T>;
}

export type RenderServiceSummary = {
  id: string;
  name: string;
  ownerId: string;
  type: string;
};

export async function fetchAccessibleServices(apiKey: string): Promise<RenderServiceSummary[]> {
  const data = await callRenderApi<{ service: RenderServiceSummary }[]>(apiKey, "/services?limit=100");
  return data.map((entry) => entry.service);
}

export type RenderDeploymentSummary = {
  id: string;
  status: string;
  createdAt: string;
};

// Statuts Render (live, build_failed, deactivated, ...) reformulés dans le même vocabulaire
// que Railway (SUCCESS/FAILED/CRASHED) : le frontend affiche les deux fournisseurs de façon
// identique, sans avoir besoin de connaître leurs statuts natifs respectifs.
function normalizeRenderStatus(status: string): string {
  if (status === "live") return "SUCCESS";
  if (["build_failed", "pre_deploy_failed", "update_failed"].includes(status)) return "FAILED";
  if (["canceled", "deactivated"].includes(status)) return "CRASHED";
  return status.toUpperCase();
}

export async function fetchLatestDeployment(
  apiKey: string,
  params: { resourceId: string }
): Promise<RenderDeploymentSummary | null> {
  const data = await callRenderApi<{ deploy: { id: string; status: string; createdAt: string } }[]>(
    apiKey,
    `/services/${params.resourceId}/deploys?limit=1`
  );

  const latest = data[0]?.deploy;
  if (!latest) return null;

  return { id: latest.id, status: normalizeRenderStatus(latest.status), createdAt: latest.createdAt };
}
