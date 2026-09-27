import { prisma } from "../../lib/prisma";
import { encryptSecret, decryptSecret } from "../../lib/encryption";
import { env } from "../../config/env";
import { refreshGitlabToken } from "./gitlab-oauth.service";

// Marge de sécurité avant l'expiration réelle du token GitLab (2h par défaut) — évite qu'un
// appel API échoue en cours de route si le token expire pile pendant la requête.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

// Retourne un access token GitLab garanti valide pour cette connexion, en le rafraîchissant
// d'abord si besoin (à la différence de Railway, voir railway-oauth.service.ts, où le refresh
// token n'est jamais utilisé — dette connue, volontairement pas reproduite ici : un token
// GitLab expiré sans refresh rendrait la connexion silencieusement inutilisable après 2h).
export async function getValidAccessToken(connectionId: string): Promise<string> {
  const connection = await prisma.gitlabConnection.findUniqueOrThrow({ where: { id: connectionId } });

  const isExpired = connection.accessTokenExpiresAt.getTime() - EXPIRY_SAFETY_MARGIN_MS <= Date.now();
  if (!isExpired) {
    return decryptSecret(connection.encryptedAccessToken);
  }

  const refreshed = await refreshGitlabToken(decryptSecret(connection.encryptedRefreshToken));

  await prisma.gitlabConnection.update({
    where: { id: connectionId },
    data: {
      encryptedAccessToken: encryptSecret(refreshed.access_token),
      encryptedRefreshToken: encryptSecret(refreshed.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });

  return refreshed.access_token;
}

async function gitlabFetch(connectionId: string, path: string, params?: Record<string, string>) {
  const accessToken = await getValidAccessToken(connectionId);
  const url = new URL(`${env.gitlab.baseUrl}/api/v4${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Appel API GitLab échoué (${response.status}) sur ${path} : ${body}`);
  }

  return response.json();
}

// email peut être absent (compte GitLab avec email privé/non confirmé) — utilisé pour le
// login GitLab, où on lie le compte Argos existant par email, à l'identique de Google
// (voir loginWithGitlab, auth.service.ts).
export type GitlabUserInfo = { id: number; username: string; avatarUrl: string; email: string | null };

export async function fetchGitlabUser(accessToken: string): Promise<GitlabUserInfo> {
  const response = await fetch(`${env.gitlab.baseUrl}/api/v4/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Impossible de récupérer l'utilisateur GitLab (${response.status}) : ${body}`);
  }

  const data = (await response.json()) as { id: number; username: string; avatar_url: string; email?: string };
  return { id: data.id, username: data.username, avatarUrl: data.avatar_url, email: data.email ?? null };
}

export type GitlabProjectSummary = {
  id: number;
  name: string;
  fullPath: string;
  defaultBranch: string;
};

// membership=true : uniquement les projets où l'utilisateur est effectivement membre (pas
// tous les projets publics de GitLab) — équivalent de listInstallationRepos côté GitHub.
export async function listGitlabProjects(connectionId: string): Promise<GitlabProjectSummary[]> {
  const projects: any[] = [];
  let page = 1;

  // Pagination par page numérotée (à la différence de GitHub, basé sur un curseur Link
  // header) — GitLab expose aussi x-total-pages en en-tête, mais une boucle simple sur une
  // page vide suffit et évite de dépendre d'un header optionnel.
  while (true) {
    const accessToken = await getValidAccessToken(connectionId);
    const url = new URL(`${env.gitlab.baseUrl}/api/v4/projects`);
    url.searchParams.set("membership", "true");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("simple", "true");

    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Impossible de récupérer les projets GitLab (${response.status}) : ${body}`);
    }

    const batch = (await response.json()) as any[];
    projects.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    fullPath: p.path_with_namespace,
    defaultBranch: p.default_branch ?? "main",
  }));
}

export async function listGitlabBranches(connectionId: string, gitlabProjectId: number): Promise<string[]> {
  const branches: any[] = [];
  let page = 1;

  while (true) {
    const accessToken = await getValidAccessToken(connectionId);
    const url = new URL(`${env.gitlab.baseUrl}/api/v4/projects/${gitlabProjectId}/repository/branches`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Impossible de récupérer les branches GitLab (${response.status}) : ${body}`);
    }

    const batch = (await response.json()) as any[];
    branches.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  return branches.map((b) => b.name);
}

export { gitlabFetch };
