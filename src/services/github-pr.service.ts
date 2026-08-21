// Création d'une pull request GitHub contenant un correctif proposé par l'IA (voir
// fix-suggestion.service.ts). N'agit que sur validation explicite de l'utilisateur — voir
// POST /api/alerts/:id/fix/accept — jamais de merge automatique, cohérent avec la règle du
// projet "fusion toujours via PR décidée par l'utilisateur".

import { getInstallationOctokit } from "./github-app.service";

export type CreateFixPullRequestParams = {
  installationId: number;
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  oldCode: string;
  newCode: string;
  explanation: string;
};

// Crée une branche dédiée depuis baseBranch, y commite le remplacement de oldCode par
// newCode dans filePath, puis ouvre une pull request vers baseBranch. Retourne l'URL de la
// PR créée.
export async function createFixPullRequest(params: CreateFixPullRequestParams): Promise<string> {
  const { installationId, owner, repo, baseBranch, filePath, oldCode, newCode, explanation } = params;
  const octokit = getInstallationOctokit(installationId);

  // Nom de branche unique pour éviter toute collision si une correction est demandée
  // plusieurs fois sur le même fichier.
  const branchName = `guardian-ai/fix-${Date.now()}`;

  const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
  await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: baseRef.object.sha });

  const { data: currentFile } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref: branchName,
  });

  if (Array.isArray(currentFile) || currentFile.type !== "file") {
    throw new Error(`Le chemin ${filePath} ne correspond pas à un fichier.`);
  }

  const currentContent = Buffer.from(currentFile.content, currentFile.encoding as BufferEncoding).toString("utf-8");

  if (!currentContent.includes(oldCode)) {
    throw new Error(
      `Le code attendu n'a pas été retrouvé tel quel dans ${filePath} (le fichier a peut-être changé depuis la proposition).`
    );
  }

  const updatedContent = currentContent.replace(oldCode, newCode);

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: `Correction : ${explanation}`,
    content: Buffer.from(updatedContent, "utf-8").toString("base64"),
    sha: currentFile.sha,
    branch: branchName,
  });

  const { data: pullRequest } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `Correction proposée : ${filePath}`,
    head: branchName,
    base: baseBranch,
    body: explanation,
  });

  return pullRequest.html_url;
}
