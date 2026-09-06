import crypto from "node:crypto";
import { env } from "../config/env";

const RAILWAY_AUTHORIZE_URL = "https://backboard.railway.com/oauth/auth";
const RAILWAY_TOKEN_URL = "https://backboard.railway.com/oauth/token";

const OAUTH_SCOPES = ["openid", "profile", "workspace:viewer", "project:viewer", "offline_access"].join(" ");

export type RailwayTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildRailwayAuthorizeUrl(params: { state: string; codeChallenge: string }) {
  const url = new URL(RAILWAY_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.railway.oauthClientId);
  url.searchParams.set("redirect_uri", env.railway.oauthRedirectUri);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  url.searchParams.set("prompt", "consent");
  return url.toString();
}

function buildClientBasicAuthHeader() {
  const credentials = Buffer.from(`${env.railway.oauthClientId}:${env.railway.oauthClientSecret}`).toString(
    "base64"
  );
  return `Basic ${credentials}`;
}

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
