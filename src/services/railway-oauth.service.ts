import crypto from "node:crypto";
import { env } from "../config/env";

// Endpoints du système "Login with Railway" (OAuth 2.0 / OIDC).
// Vérifiés via le document de découverte OpenID de Railway :
// https://backboard.railway.com/oauth/.well-known/openid-configuration
const RAILWAY_AUTHORIZE_URL = "https://backboard.railway.com/oauth/auth";
const RAILWAY_TOKEN_URL = "https://backboard.railway.com/oauth/token";

// Scope demandé : identité de base + accès en lecture aux workspaces et projets de l'utilisateur.
// Le champ racine GraphQL "projects" (liste tous les projets, tous workspaces confondus)
// semble nécessiter "workspace:viewer" en plus de "project:viewer" — non documenté
// explicitement par Railway, déduit empiriquement (voir historique de debug).
// "offline_access" permet d'obtenir un refresh token (l'access token expire au bout d'1h).
const OAUTH_SCOPES = ["openid", "profile", "workspace:viewer", "project:viewer", "offline_access"].join(" ");

export type RailwayTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

// Génère un vérifieur PKCE (code_verifier) et son challenge associé (code_challenge, méthode S256).
export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

// Construit l'URL vers laquelle rediriger l'utilisateur pour qu'il autorise Guardian AI
// à accéder à son compte Railway.
export function buildRailwayAuthorizeUrl(params: { state: string; codeChallenge: string }) {
  const url = new URL(RAILWAY_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.railway.oauthClientId);
  url.searchParams.set("redirect_uri", env.railway.oauthRedirectUri);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Nécessaire pour que Railway émette un refresh_token (offline_access seul ne suffit pas).
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

// En-tête d'authentification du client OAuth, attendu par Railway en Basic Auth
// (voir doc quickstart : -u client_id:client_secret), plutôt qu'en paramètres du body.
function buildClientBasicAuthHeader() {
  const credentials = Buffer.from(`${env.railway.oauthClientId}:${env.railway.oauthClientSecret}`).toString(
    "base64"
  );
  return `Basic ${credentials}`;
}

// Échange le code d'autorisation reçu sur le callback contre un access token + refresh token.
export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
}): Promise<RailwayTokenResponse> {
  const response = await fetch(RAILWAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: buildClientBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: env.railway.oauthRedirectUri,
      code_verifier: params.codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Échec de l'échange du code OAuth Railway (${response.status}) : ${body}`);
  }

  return response.json() as Promise<RailwayTokenResponse>;
}

// Rafraîchit un access token expiré à partir du refresh token stocké.
export async function refreshRailwayToken(refreshToken: string): Promise<RailwayTokenResponse> {
  const response = await fetch(RAILWAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: buildClientBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Échec du rafraîchissement du token OAuth Railway (${response.status}) : ${body}`);
  }

  return response.json() as Promise<RailwayTokenResponse>;
}
