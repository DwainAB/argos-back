import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";
import { buildGithubAuthorizeUrl, exchangeGithubCodeForToken, fetchGithubProfile } from "../services/auth/github-oauth.service";
import { logger } from "../lib/logger";

// Même mécanique que la connexion GitLab (gitlab-integration.route.ts) : popup ouverte par
// le frontend, callback qui referme la popup via postMessage plutôt qu'une redirection pleine
// page. Distinct de github-integration.route.ts (installation de la GitHub App sur un dépôt) :
// ici le but est uniquement d'authentifier l'utilisateur pour se connecter à Argos AI.
export const githubLoginRouter = Router();

const STATE_COOKIE = "github_login_oauth_state";
const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
  maxAge: 10 * 60 * 1000,
};

githubLoginRouter.get("/api/integrations/github-login/start", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTIONS);
  res.redirect(buildGithubAuthorizeUrl(state));
});

function renderPostMessagePage(payload: Record<string, unknown>) {
  return `<!doctype html>
<html><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify({ source: "argos-github-login", ...payload })}, ${JSON.stringify(env.frontendUrl)});
  }
  window.close();
</script>
</body></html>`;
}

githubLoginRouter.get("/api/integrations/github-login/callback", async (req, res) => {
  const { code, state, error } = req.query;

  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { httpOnly: STATE_COOKIE_OPTIONS.httpOnly, secure: STATE_COOKIE_OPTIONS.secure, sameSite: STATE_COOKIE_OPTIONS.sameSite });

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (error) {
    return res.send(renderPostMessagePage({ error: String(error) }));
  }

  if (!code || !state || state !== expectedState) {
    return res.send(renderPostMessagePage({ error: "invalid_state" }));
  }

  try {
    const accessToken = await exchangeGithubCodeForToken(String(code));
    const profile = await fetchGithubProfile(accessToken);

    res.send(renderPostMessagePage({ githubUserId: profile.id, githubUserEmail: profile.email }));
  } catch (err) {
    logger.error({ err }, "Erreur lors de l'échange du code OAuth GitHub (login) :");
    res.send(renderPostMessagePage({ error: "token_exchange_failed" }));
  }
});
