// Exploration d'un dépôt GitHub à la demande, sans clone : l'arborescence puis le
// contenu des fichiers sont lus via l'API GitHub, fichier par fichier, uniquement pour
// ceux jugés pertinents. Sert de base commune au diagnostic local (Ollama) et, plus
// tard, à la correction par une IA distante — tous deux naviguent dans le repo via ces
// mêmes fonctions plutôt que de recevoir tout le code d'un coup.

import { getInstallationOctokit } from "./github-app.service";

// Taille max d'un fichier qu'on accepte de lire (évite de charger un binaire ou un
// fichier généré massif dans un prompt IA).
const MAX_FILE_SIZE_BYTES = 200 * 1024;

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
  | { ok: false; path: string; reason: "not_found" | "too_large" | "not_a_file" };

// Lit le contenu d'un fichier précis du repo, à une branche/ref donnée. Retourne un
// résultat typé plutôt que de lever une exception : un chemin invalide ou un fichier
// trop volumineux sont des issues attendues pendant l'exploration, pas des erreurs.
export async function getFileContent(
  installationId: number,
  params: { owner: string; repo: string; path: string; ref: string }
): Promise<FileContentResult> {
  const octokit = getInstallationOctokit(installationId);

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref,
    });

    if (Array.isArray(data) || data.type !== "file") {
      return { ok: false, path: params.path, reason: "not_a_file" };
    }

    if (data.size > MAX_FILE_SIZE_BYTES) {
      return { ok: false, path: params.path, reason: "too_large" };
    }

    const content = Buffer.from(data.content, data.encoding as BufferEncoding).toString("utf-8");
    return { ok: true, path: params.path, content };
  } catch (err: any) {
    if (err?.status === 404) {
      return { ok: false, path: params.path, reason: "not_found" };
    }
    throw err;
  }
}
