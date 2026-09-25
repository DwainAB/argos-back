import type { RailwayTokenResponse } from "./railway-oauth.service";

type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  obtainedAt: number;
  expiresIn: number;
};

let lastToken: StoredToken | null = null;

export function storeRailwayToken(token: RailwayTokenResponse) {
  lastToken = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    obtainedAt: Date.now(),
    expiresIn: token.expires_in,
  };
}

export function getStoredRailwayToken(): StoredToken | null {
  return lastToken;
}
