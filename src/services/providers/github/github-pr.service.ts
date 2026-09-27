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

export async function createFixPullRequest(params: CreateFixPullRequestParams): Promise<string> {
  const { installationId, owner, repo, baseBranch, filePath, oldCode, newCode, explanation } = params;
  const octokit = getInstallationOctokit(installationId);

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
