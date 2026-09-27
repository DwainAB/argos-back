import { env } from "../../config/env";
import { getValidAccessToken } from "./gitlab-api.service";

// Équivalent GitLab de github-pr.service.ts : mêmes étapes (branche, lecture du fichier
// courant, remplacement du code, commit, ouverture de la requête de fusion), adaptées à
// l'API REST GitLab (v4).
export type CreateFixMergeRequestParams = {
  connectionId: string;
  gitlabProjectId: number;
  baseBranch: string;
  filePath: string;
  oldCode: string;
  newCode: string;
  explanation: string;
  commitMessage: string;
};

export async function createFixMergeRequest(params: CreateFixMergeRequestParams): Promise<string> {
  const { connectionId, gitlabProjectId, baseBranch, filePath, oldCode, newCode, explanation, commitMessage } = params;

  const branchName = `guardian-ai/fix-${Date.now()}`;
  const encodedPath = encodeURIComponent(filePath);

  const createBranchToken = await getValidAccessToken(connectionId);
  const createBranchUrl = new URL(`${env.gitlab.baseUrl}/api/v4/projects/${gitlabProjectId}/repository/branches`);
  createBranchUrl.searchParams.set("branch", branchName);
  createBranchUrl.searchParams.set("ref", baseBranch);

  const branchResponse = await fetch(createBranchUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${createBranchToken}` },
  });
  if (!branchResponse.ok) {
    const body = await branchResponse.text();
    throw new Error(`Impossible de créer la branche GitLab ${branchName} (${branchResponse.status}) : ${body}`);
  }

  const getFileToken = await getValidAccessToken(connectionId);
  const getFileUrl = new URL(`${env.gitlab.baseUrl}/api/v4/projects/${gitlabProjectId}/repository/files/${encodedPath}`);
  getFileUrl.searchParams.set("ref", branchName);

  const fileResponse = await fetch(getFileUrl, { headers: { Authorization: `Bearer ${getFileToken}` } });
  if (!fileResponse.ok) {
    const body = await fileResponse.text();
    throw new Error(`Le chemin ${filePath} est introuvable sur GitLab (${fileResponse.status}) : ${body}`);
  }

  const file = (await fileResponse.json()) as { content: string; encoding: string };
  if (file.encoding !== "base64") {
    throw new Error(`Le chemin ${filePath} ne correspond pas à un fichier.`);
  }

  const currentContent = Buffer.from(file.content, "base64").toString("utf-8");

  if (!currentContent.includes(oldCode)) {
    throw new Error(
      `Le code attendu n'a pas été retrouvé tel quel dans ${filePath} (le fichier a peut-être changé depuis la proposition).`
    );
  }

  const updatedContent = currentContent.replace(oldCode, newCode);

  const updateFileToken = await getValidAccessToken(connectionId);
  const updateFileUrl = `${env.gitlab.baseUrl}/api/v4/projects/${gitlabProjectId}/repository/files/${encodedPath}`;

  const updateResponse = await fetch(updateFileUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${updateFileToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: branchName,
      content: updatedContent,
      commit_message: commitMessage,
    }),
  });
  if (!updateResponse.ok) {
    const body = await updateResponse.text();
    throw new Error(`Impossible de committer le correctif sur GitLab (${updateResponse.status}) : ${body}`);
  }

  const createMrToken = await getValidAccessToken(connectionId);
  const createMrUrl = `${env.gitlab.baseUrl}/api/v4/projects/${gitlabProjectId}/merge_requests`;

  const mrResponse = await fetch(createMrUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createMrToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_branch: branchName,
      target_branch: baseBranch,
      title: `Correction proposée : ${filePath}`,
      description: explanation,
    }),
  });
  if (!mrResponse.ok) {
    const body = await mrResponse.text();
    throw new Error(`Impossible de créer la merge request GitLab (${mrResponse.status}) : ${body}`);
  }

  const mergeRequest = (await mrResponse.json()) as { web_url: string };
  return mergeRequest.web_url;
}
