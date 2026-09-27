import crypto from "node:crypto";
import { env } from "../../config/env";

// Flow OAuth2 avec PKCE (comme Railway, voir railway-oauth.service.ts) — GitLab le supporte
// nativement et le recommande pour toute Application publique. Scope "api" (lecture+écriture)
// plutôt que read_api/read_repository seuls : l'analyse de code n'a besoin que de lecture,
// mais l'écriture est anticipée pour la création de merge requests de correction (v2, voir
// CAHIER_DES_CHARGES.md — équivalent GitLab de createFixPullRequest côté GitHub), pour éviter
// de redemander une reconnexion à l'utilisateur une fois cette fonctionnalité développée.
const OAUTH_SCOPES = ["api"].join(" ");

function authorizeUrl() {
  return `${env.gitlab.baseUrl}/oauth/authorize`;
}

function tokenUrl() {
  return `${env.gitlab.baseUrl}/oauth/token`;
}

export type GitlabTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildGitlabAuthorizeUrl(params: { state: string; codeChallenge: string }) {
  const url = new URL(authorizeUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.gitlab.clientId);
  url.searchParams.set("redirect_uri", env.gitlab.redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCodeForToken(params: { code: string; codeVerifier: string }): Promise<GitlabTokenResponse> {
  const response = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.gitlab.clientId,
      client_secret: env.gitlab.clientSecret,
      code: params.code,
      redirect_uri: env.gitlab.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Échec de l'échange du code OAuth GitLab (${response.status}) : ${body}`);
  }

  return response.json() as Promise<GitlabTokenResponse>;
}

export async function refreshGitlabToken(refreshToken: string): Promise<GitlabTokenResponse> {
  const response = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.gitlab.clientId,
      client_secret: env.gitlab.clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Échec du rafraîchissement du token OAuth GitLab (${response.status}) : ${body}`);
  }

  return response.json() as Promise<GitlabTokenResponse>;
}
