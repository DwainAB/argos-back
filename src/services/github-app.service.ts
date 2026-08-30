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
// Exporté pour être réutilisé par les autres services ayant besoin de lire ces repos
// (voir backend/src/services/github-repo-explorer.service.ts).
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

// Client Octokit authentifié au niveau de l'app elle-même (JWT d'app, pas de token
// d'installation) — utilisé uniquement pour lister les installations existantes.
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

// Liste les installations existantes de la GitHub App, tous comptes/organisations
// confondus. Pas de filtrage par utilisateur Argos AI pour l'instant : un seul compte
// réel utilise l'app aujourd'hui. À restreindre le jour où plusieurs comptes Argos AI
// coexisteront (via une table de liaison utilisateur ↔ installations autorisées).
// Permet de proposer une installation déjà existante sans repasser par le flux GitHub
// (qui, une fois l'app déjà installée sur le compte choisi, ne redirige jamais vers
// notre Setup URL/callback — voir JOURNAL.md).
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
