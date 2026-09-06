import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";
import {
  buildRailwayAuthorizeUrl,
  exchangeCodeForToken,
  generatePkcePair,
} from "../services/railway-oauth.service";
import { storeRailwayToken, getStoredRailwayToken } from "../services/railway-token-store.service";
import { fetchAccessibleProjects, fetchLatestDeploymentLogs, fetchMe } from "../services/railway-api.service";

export const railwayIntegrationRouter = Router();

const STATE_COOKIE = "railway_oauth_state";
const VERIFIER_COOKIE = "railway_oauth_verifier";

const TEMP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.port !== 4000 || process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 5 * 60 * 1000,
};

railwayIntegrationRouter.get("/api/integrations/railway/start", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();

  res.cookie(STATE_COOKIE, state, TEMP_COOKIE_OPTIONS);
  res.cookie(VERIFIER_COOKIE, codeVerifier, TEMP_COOKIE_OPTIONS);

  const authorizeUrl = buildRailwayAuthorizeUrl({ state, codeChallenge });
  res.redirect(authorizeUrl);
});

railwayIntegrationRouter.get("/api/integrations/railway/callback", async (req, res) => {
  const { code, state, error } = req.query;

  const expectedState = req.cookies?.[STATE_COOKIE];
  const codeVerifier = req.cookies?.[VERIFIER_COOKIE];

  res.clearCookie(STATE_COOKIE);
  res.clearCookie(VERIFIER_COOKIE);

  if (error) {
    return res.redirect(`${env.frontendUrl}/dashboard/projects/new?railway_error=${encodeURIComponent(String(error))}`);
  }

  if (!code || !state || !codeVerifier || state !== expectedState) {
    return res.redirect(`${env.frontendUrl}/dashboard/projects/new?railway_error=invalid_state`);
  }

  try {
    const token = await exchangeCodeForToken({ code: String(code), codeVerifier });

    console.log("DEBUG token reçu :", {
      token_type: token.token_type,
      expires_in: token.expires_in,
      has_refresh_token: !!token.refresh_token,
      access_token_preview: token.access_token ? `${token.access_token.slice(0, 20)}...` : null,
      access_token_length: token.access_token?.length,
    });

    storeRailwayToken(token);

    res.redirect(`${env.frontendUrl}/dashboard/projects/new?railway_connected=true`);
  } catch (err) {
    console.error("Erreur lors de l'échange du code OAuth Railway :", err);
    res.redirect(`${env.frontendUrl}/dashboard/projects/new?railway_error=token_exchange_failed`);
  }
});

railwayIntegrationRouter.get("/api/integrations/railway/debug-oauth-me", async (_req, res) => {
  const stored = getStoredRailwayToken();

  if (!stored) {
    return res.status(401).json({ error: "Aucune connexion Railway active." });
  }

  try {
    const response = await fetch("https://backboard.railway.com/oauth/me", {
      headers: { Authorization: `Bearer ${stored.accessToken}` },
    });
    const body = await response.text();
    res.status(response.status).json({ status: response.status, body });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur inconnue" });
  }
});

railwayIntegrationRouter.get("/api/integrations/railway/debug-me", async (_req, res) => {
  const stored = getStoredRailwayToken();

  if (!stored) {
    return res.status(401).json({ error: "Aucune connexion Railway active." });
  }

  try {
    const me = await fetchMe(stored.accessToken);
    res.json({ me, tokenInfo: { expiresIn: stored.expiresIn, hasRefreshToken: !!stored.refreshToken } });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur inconnue" });
  }
});

railwayIntegrationRouter.get("/api/integrations/railway/projects", async (_req, res) => {
  const stored = getStoredRailwayToken();

  if (!stored) {
    return res.status(401).json({ error: "Aucune connexion Railway active. Lancez le flux de connexion d'abord." });
  }

  try {
    const projects = await fetchAccessibleProjects(stored.accessToken);
    res.json({ projects });
  } catch (err) {
    console.error("Erreur lors de la récupération des projets Railway :", err);
    res.status(502).json({ error: "Impossible de récupérer les projets Railway." });
  }
});

railwayIntegrationRouter.get("/api/integrations/railway/test-logs", async (req, res) => {
  const stored = getStoredRailwayToken();

  if (!stored) {
    return res.status(401).json({ error: "Aucune connexion Railway active. Lancez le flux de connexion d'abord." });
  }

  const { serviceId, environmentId } = req.query;

  if (!serviceId || !environmentId) {
    return res.status(400).json({ error: "Paramètres serviceId et environmentId requis." });
  }

  try {
    const logs = await fetchLatestDeploymentLogs(stored.accessToken, {
      serviceId: String(serviceId),
      environmentId: String(environmentId),
    });
    res.json({ logs });
  } catch (err) {
    console.error("Erreur lors de la récupération des logs Railway :", err);
    res.status(502).json({ error: "Impossible de récupérer les logs Railway." });
  }
});
