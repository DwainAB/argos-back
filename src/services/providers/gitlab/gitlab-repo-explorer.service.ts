import { env } from "../../../config/env";
import { getValidAccessToken } from "./gitlab-api.service";

// Équivalent GitLab de github-repo-explorer.service.ts : même contrat de sortie (RepoTreeEntry,
// FileContentResult, FileContentRangeResult) pour que code-analysis.service.ts et le reste du
// pipeline d'analyse IA restent agnostiques du fournisseur de code source.
const MAX_FILE_SIZE_BYTES = 100 * 1024;

export type RepoTreeEntry = {
  path: string;
  type: "blob" | "tree";
  size?: number;
};

export async function getRepoTree(
  connectionId: string,
  params: { gitlabProjectId: number; ref: string }
): Promise<RepoTreeEntry[]> {
  const entries: RepoTreeEntry[] = [];
  let page = 1;

  while (true) {
    const accessToken = await getValidAccessToken(connectionId);
    const url = new URL(`${env.gitlab.baseUrl}/api/v4/projects/${params.gitlabProjectId}/repository/tree`);
    url.searchParams.set("ref", params.ref);
    url.searchParams.set("recursive", "true");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Impossible de récupérer l'arbre du dépôt GitLab (${response.status}) : ${body}`);
    }

    const batch = (await response.json()) as { path: string; type: "blob" | "tree" }[];
    entries.push(...batch.map((e) => ({ path: e.path, type: e.type })));
    if (batch.length < 100) break;
    page++;
  }

  return entries;
}

export type FileContentResult =
  | { ok: true; path: string; content: string }
  | { ok: false; path: string; reason: "not_found" | "too_large" | "not_a_file"; totalLines?: number };

async function fetchRawFile(
  connectionId: string,
  params: { gitlabProjectId: number; path: string; ref: string }
): Promise<{ ok: true; content: string; sizeBytes: number } | { ok: false; reason: "not_found" | "not_a_file" }> {
  const accessToken = await getValidAccessToken(connectionId);

  // Le chemin du fichier doit être URL-encodé dans le path de la requête (voir doc API
  // Repository files de GitLab), contrairement à GitHub où il est passé tel quel.
  const encodedPath = encodeURIComponent(params.path);
  const url = new URL(`${env.gitlab.baseUrl}/api/v4/projects/${params.gitlabProjectId}/repository/files/${encodedPath}`);
  url.searchParams.set("ref", params.ref);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (response.status === 404) {
    return { ok: false, reason: "not_found" };
  }
  // GitLab renvoie 400 (pas 404) pour un chemin syntaxiquement invalide — notamment un chemin
  // absolu du serveur de déploiement (ex: "/opt/render/project/src/server.js", extrait tel
  // quel d'une stack trace par l'IA de fix-suggestion.service.ts) au lieu du chemin relatif
  // dans le dépôt Git. Traité comme "not_found" plutôt que de faire échouer toute la requête :
  // l'IA peut alors s'ajuster (list_files) et retenter, à l'identique d'un vrai fichier absent.
  if (response.status === 400) {
    return { ok: false, reason: "not_found" };
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Impossible de récupérer le fichier GitLab ${params.path} (${response.status}) : ${body}`);
  }

  const data = (await response.json()) as { content: string; encoding: string; size: number };
  if (data.encoding !== "base64") {
    return { ok: false, reason: "not_a_file" };
  }

  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { ok: true, content, sizeBytes: data.size };
}

export async function getFileContent(
  connectionId: string,
  params: { gitlabProjectId: number; path: string; ref: string }
): Promise<FileContentResult> {
  const raw = await fetchRawFile(connectionId, params);

  if (!raw.ok) {
    return { ok: false, path: params.path, reason: raw.reason };
  }

  if (raw.sizeBytes > MAX_FILE_SIZE_BYTES) {
    const totalLines = raw.content.split("\n").length;
    return { ok: false, path: params.path, reason: "too_large", totalLines };
  }

  return { ok: true, path: params.path, content: raw.content };
}

export type FileContentRangeResult =
  | { ok: true; path: string; content: string; startLine: number; endLine: number; totalLines: number }
  | { ok: false; path: string; reason: "not_found" | "not_a_file" };

export async function getFileContentRange(
  connectionId: string,
  params: { gitlabProjectId: number; path: string; ref: string; startLine: number; endLine: number }
): Promise<FileContentRangeResult> {
  const raw = await fetchRawFile(connectionId, params);

  if (!raw.ok) {
    return { ok: false, path: params.path, reason: raw.reason };
  }

  const lines = raw.content.split("\n");
  const totalLines = lines.length;
  const start = Math.max(1, params.startLine);
  const end = Math.min(totalLines, params.endLine);

  const content = lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}: ${line}`)
    .join("\n");

  return { ok: true, path: params.path, content, startLine: start, endLine: end, totalLines };
}
