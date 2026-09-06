import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { env } from "../config/env";

export function buildGithubInstallUrl(state: string) {
  const url = new URL(`https://github.com/apps/${env.github.slug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function getInstallationOctokit(installationId: number) {
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

function getAppOctokit() {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.github.appId,
      privateKey: env.github.privateKey,
      clientId: env.github.clientId,
      clientSecret: env.github.clientSecret,
    },
  });
}

export type GithubInstallationSummary = {
  id: number;
  accountLogin: string;
  accountAvatarUrl: string;
};

export async function listAppInstallations(): Promise<GithubInstallationSummary[]> {
  const octokit = getAppOctokit();
  const { data } = await octokit.request("GET /app/installations", { per_page: 100 });

  return data
    .filter((installation) => !!installation.account)
    .map((installation) => ({
      id: installation.id,
      accountLogin: (installation.account as { login?: string; slug?: string }).login
        ?? (installation.account as { login?: string; slug?: string }).slug
        ?? "compte inconnu",
      accountAvatarUrl: (installation.account as { avatar_url?: string }).avatar_url ?? "",
    }));
}

export type GithubRepoSummary = {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
};

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
