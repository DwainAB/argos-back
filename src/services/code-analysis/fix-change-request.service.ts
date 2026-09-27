import type { Project } from "@prisma/client";
import { createFixPullRequest } from "../github/github-pr.service";
import { createFixMergeRequest } from "../gitlab/gitlab-mr.service";

export type FixChangeRequestParams = {
  filePath: string;
  oldCode: string;
  newCode: string;
  explanation: string;
};

// Dispatch vers GitHub (pull request) ou GitLab (merge request) selon le fournisseur de code
// connecté au projet — même logique de priorité que buildCodeSource (code-analysis.service.ts).
// Retourne dans les deux cas l'URL de la requête créée (pullRequestUrl reste un nom de champ
// Prisma valide, il stocke une URL générique).
export async function createFixChangeRequest(project: Project, params: FixChangeRequestParams): Promise<string> {
  if (project.githubInstallationId && project.githubRepo && project.githubBranch) {
    const [owner, repo] = project.githubRepo.split("/");
    return createFixPullRequest({
      installationId: project.githubInstallationId,
      owner,
      repo,
      baseBranch: project.githubBranch,
      ...params,
    });
  }

  if (project.gitlabConnectionId && project.gitlabProjectId && project.gitlabBranch) {
    return createFixMergeRequest({
      connectionId: project.gitlabConnectionId,
      gitlabProjectId: project.gitlabProjectId,
      baseBranch: project.gitlabBranch,
      ...params,
    });
  }

  throw new Error("Ce projet n'a pas de dépôt GitHub ou GitLab connecté.");
}
