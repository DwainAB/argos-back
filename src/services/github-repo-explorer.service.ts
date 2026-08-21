// Exploration d'un dépôt GitHub à la demande, sans clone : l'arborescence puis le
// contenu des fichiers sont lus via l'API GitHub, fichier par fichier, uniquement pour
// ceux jugés pertinents. Sert de base commune à l'explication/triage par l'IA locale et
// à la correction par l'IA distante (voir fix-suggestion.service.ts) — toutes naviguent
// dans le repo via ces mêmes fonctions plutôt que de recevoir tout le code d'un coup.

import { getInstallationOctokit } from "./github-app.service";

// Taille max d'un fichier qu'on accepte de lire en entier. Au-delà, un fichier trop gros
// doit être lu par extraits ciblés via getFileContentRange plutôt qu'en entier — sans quoi
// même un modèle distant capable (GPT-4.1) a été observé dériver sur un très gros fichier
// (relecture du même fichier, puis recherche de chemins hallucinés, voir JOURNAL.md).
// 100 Ko reste confortable pour un modèle à grand contexte (GPT-4.1) tout en écartant les
// cas extrêmes (fichiers générés, minifiés, etc.).
const MAX_FILE_SIZE_BYTES = 100 * 1024;

export type RepoTreeEntry = {
  path: string;
  type: "blob" | "tree";
};

// Récupère l'arborescence complète d'un repo (chemins de tous les fichiers et dossiers)
// en un seul appel, à une branche/ref donnée. Sert de point de départ à l'exploration :
// l'IA choisit ensuite quels fichiers lire réellement via getFileContent.
export async function getRepoTree(
  installationId: number,
  params: { owner: string; repo: string; ref: string }
): Promise<RepoTreeEntry[]> {
  const octokit = getInstallationOctokit(installationId);

  const { data: refData } = await octokit.rest.git.getRef({
    owner: params.owner,
    repo: params.repo,
    ref: `heads/${params.ref}`,
  });

  const { data: tree } = await octokit.rest.git.getTree({
    owner: params.owner,
    repo: params.repo,
    tree_sha: refData.object.sha,
    recursive: "true",
  });

  return tree.tree
    .filter((entry): entry is typeof entry & { path: string; type: "blob" | "tree" } =>
      Boolean(entry.path) && (entry.type === "blob" || entry.type === "tree")
    )
    .map((entry) => ({ path: entry.path, type: entry.type }));
}

export type FileContentResult =
  | { ok: true; path: string; content: string }
  | { ok: false; path: string; reason: "not_found" | "too_large" | "not_a_file"; totalLines?: number };

// Récupère le contenu brut d'un fichier (texte + taille), sans limite — usage interne,
// partagé par getFileContent et getFileContentRange.
async function fetchRawFile(
  installationId: number,
  params: { owner: string; repo: string; path: string; ref: string }
): Promise<{ ok: true; content: string; sizeBytes: number } | { ok: false; reason: "not_found" | "not_a_file" }> {
  const octokit = getInstallationOctokit(installationId);

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref,
    });

    if (Array.isArray(data) || data.type !== "file") {
      return { ok: false, reason: "not_a_file" };
    }

    const content = Buffer.from(data.content, data.encoding as BufferEncoding).toString("utf-8");
    return { ok: true, content, sizeBytes: data.size };
  } catch (err: any) {
    if (err?.status === 404) {
      return { ok: false, reason: "not_found" };
    }
    throw err;
  }
}

// Lit le contenu d'un fichier précis du repo, à une branche/ref donnée. Retourne un
// résultat typé plutôt que de lever une exception : un chemin invalide ou un fichier
// trop volumineux sont des issues attendues pendant l'exploration, pas des erreurs.
// Si le fichier dépasse la taille max, "too_large" indique aussi son nombre total de
// lignes, pour orienter vers getFileContentRange plutôt que vers une impasse.
export async function getFileContent(
  installationId: number,
  params: { owner: string; repo: string; path: string; ref: string }
): Promise<FileContentResult> {
  const raw = await fetchRawFile(installationId, params);

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

// Lit uniquement une plage de lignes d'un fichier, quelle que soit sa taille totale —
// pensé pour cibler la zone signalée par une stack trace (fichier + numéro de ligne) sans
// jamais charger un fichier volumineux en entier dans le contexte du modèle.
export async function getFileContentRange(
  installationId: number,
  params: { owner: string; repo: string; path: string; ref: string; startLine: number; endLine: number }
): Promise<FileContentRangeResult> {
  const raw = await fetchRawFile(installationId, params);

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
