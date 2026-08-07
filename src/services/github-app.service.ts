// Intégration GitHub via GitHub App : installation par l'utilisateur sur ses repos,
// puis accès à ces repos avec un token d'installation (scope limité, révocable depuis GitHub).

import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { env } from "../config/env";

// Construit l'URL vers laquelle rediriger l'utilisateur pour installer la GitHub App
// sur les repos de son choix.
export function buildGithubInstallUrl(state: string) {
  const url = new URL(`https://github.com/apps/${env.github.slug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

// Client Octokit authentifié en tant qu'installation précise (accès aux repos que
// l'utilisateur a choisi de partager avec la GitHub App lors de l'installation).
function getInstallationOctokit(installationId: number) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.github.appId,
      privateKey: env.github.privateKey,
      clientId: env.github.clientId,
      clientSecret: env.github.clientSecret,
      installationId,
    },
  });
}

export type GithubRepoSummary = {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
};

// Liste les repos accessibles pour une installation donnée.
export async function listInstallationRepos(installationId: number): Promise<GithubRepoSummary[]> {
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.request("GET /installation/repositories");

  return data.repositories.map((repo) => ({
    id: Number(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
  }));
}

// Liste les branches d'un repo précis, accessible via l'installation.
export async function listRepoBranches(
  installationId: number,
  params: { owner: string; repo: string }
): Promise<string[]> {
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.repos.listBranches({
    owner: params.owner,
    repo: params.repo,
    per_page: 100,
  });

  return data.map((branch) => branch.name);
}
