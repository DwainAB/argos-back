import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/encryption";
import {
  buildGitlabAuthorizeUrl,
  exchangeCodeForToken,
  generatePkcePair,
} from "../services/providers/gitlab/gitlab-oauth.service";
import { fetchGitlabUser, listGitlabProjects, listGitlabBranches } from "../services/providers/gitlab/gitlab-api.service";
import { projectAccessFilter } from "../services/organization/project-access.service";
import { assertCanManageProject, OrganizationError } from "../services/organization/organization.service";

// Même mécanique que l'installation GitHub (github-integration.route.ts) : popup ouverte par
// le frontend, callback qui referme la popup via postMessage plutôt qu'une redirection pleine
// page — évite de perdre l'état de la page "Nouveau projet"/"Paramètres" pendant la connexion.
export const gitlabPublicRouter = Router();
export const gitlabIntegrationRouter = Router();

const STATE_COOKIE = "gitlab_oauth_state";
const VERIFIER_COOKIE = "gitlab_oauth_verifier";
const TEMP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 10 * 60 * 1000,
};

gitlabPublicRouter.get("/api/integrations/gitlab/start", (req, res) => {
  const projectId = String(req.query.projectId ?? "");
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${nonce}.${projectId}`;
  const { codeVerifier, codeChallenge } = generatePkcePair();

  res.cookie(STATE_COOKIE, nonce, TEMP_COOKIE_OPTIONS);
  res.cookie(VERIFIER_COOKIE, codeVerifier, TEMP_COOKIE_OPTIONS);

  res.redirect(buildGitlabAuthorizeUrl({ state, codeChallenge }));
});

function renderPostMessagePage(payload: Record<string, unknown>) {
  return `<!doctype html>
<html><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify({ source: "argos-gitlab-connect", ...payload })}, ${JSON.stringify(env.frontendUrl)});
  }
  window.close();
</script>
</body></html>`;
}

gitlabPublicRouter.get("/api/integrations/gitlab/callback", async (req, res) => {
  const { code, state, error } = req.query;

  const expectedNonce = req.cookies?.[STATE_COOKIE];
  const codeVerifier = req.cookies?.[VERIFIER_COOKIE];
  res.clearCookie(STATE_COOKIE);
  res.clearCookie(VERIFIER_COOKIE);

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (error) {
    return res.send(renderPostMessagePage({ error: String(error) }));
  }

  const [nonce, projectId] = String(state ?? "").split(".");
  if (!code || !nonce || nonce !== expectedNonce || !codeVerifier) {
    return res.send(renderPostMessagePage({ error: "invalid_state" }));
  }

  try {
    const token = await exchangeCodeForToken({ code: String(code), codeVerifier });
    const gitlabUser = await fetchGitlabUser(token.access_token);

    // req.userId n'est pas disponible ici : ce endpoint est public (pas de authMiddleware,
    // même contrainte que le callback GitHub) car GitLab redirige directement le navigateur
    // dessus, sans pouvoir transmettre de cookie de session cross-site fiable à ce stade.
    // La connexion est donc associée à l'utilisateur juste après, depuis la popup, via
    // POST /api/gitlab-connections (route authentifiée) — ce callback ne fait que remonter
    // le token à la fenêtre parente par postMessage, jamais stocké tel quel côté client.
    res.send(
      renderPostMessagePage({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresIn: token.expires_in,
        gitlabUserId: gitlabUser.id,
        gitlabUserLogin: gitlabUser.username,
        gitlabUserEmail: gitlabUser.email,
        projectId: projectId || null,
      })
    );
  } catch (err) {
    console.error("Erreur lors de l'échange du code OAuth GitLab :", err);
    res.send(renderPostMessagePage({ error: "token_exchange_failed" }));
  }
});

// Persiste la connexion GitLab pour l'utilisateur/organisation courant, à partir du token
// obtenu par la popup de callback ci-dessus — voir le commentaire du callback pour le pourquoi
// de cette étape séparée plutôt qu'un stockage direct depuis /callback.
gitlabIntegrationRouter.post("/api/gitlab-connections", async (req, res) => {
  const { accessToken, refreshToken, expiresIn, gitlabUserId, gitlabUserLogin } = req.body ?? {};

  if (!accessToken || !refreshToken || !expiresIn || !gitlabUserId || !gitlabUserLogin) {
    return res.status(400).json({ error: "Informations de connexion GitLab incomplètes." });
  }

  try {
    const membership = await prisma.organizationMembership.findUnique({ where: { userId: req.userId as string } });

    const connection = await prisma.gitlabConnection.create({
      data: {
        userId: membership ? null : (req.userId as string),
        organizationId: membership ? membership.organizationId : null,
        gitlabUserId: Number(gitlabUserId),
        gitlabUserLogin: String(gitlabUserLogin),
        encryptedAccessToken: encryptSecret(String(accessToken)),
        encryptedRefreshToken: encryptSecret(String(refreshToken)),
        accessTokenExpiresAt: new Date(Date.now() + Number(expiresIn) * 1000),
      },
    });

    res.status(201).json({ connectionId: connection.id, gitlabUserLogin: connection.gitlabUserLogin });
  } catch (err) {
    console.error("Erreur lors de l'enregistrement de la connexion GitLab :", err);
    res.status(500).json({ error: "Impossible d'enregistrer la connexion GitLab." });
  }
});

gitlabIntegrationRouter.get("/api/integrations/gitlab/projects", async (req, res) => {
  const connectionId = String(req.query.connectionId ?? "");

  if (!connectionId) {
    return res.status(400).json({ error: "connectionId requis." });
  }

  try {
    const projects = await listGitlabProjects(connectionId);
    res.json({ projects });
  } catch (err) {
    console.error("Erreur lors de la récupération des projets GitLab :", err);
    res.status(502).json({ error: "Impossible de récupérer les projets GitLab." });
  }
});

gitlabIntegrationRouter.get("/api/integrations/gitlab/branches", async (req, res) => {
  const connectionId = String(req.query.connectionId ?? "");
  const gitlabProjectId = Number(req.query.gitlabProjectId);

  if (!connectionId || !gitlabProjectId) {
    return res.status(400).json({ error: "connectionId et gitlabProjectId sont requis." });
  }

  try {
    const branches = await listGitlabBranches(connectionId, gitlabProjectId);
    res.json({ branches });
  } catch (err) {
    console.error("Erreur lors de la récupération des branches GitLab :", err);
    res.status(502).json({ error: "Impossible de récupérer les branches GitLab." });
  }
});

gitlabIntegrationRouter.post("/api/projects/:projectId/gitlab", async (req, res) => {
  const { projectId } = req.params;
  const { connectionId, gitlabProjectId, repoFullPath, branch } = req.body ?? {};

  if (!connectionId || !gitlabProjectId || !repoFullPath || !branch) {
    return res.status(400).json({ error: "connectionId, gitlabProjectId, repoFullPath et branch sont requis." });
  }

  try {
    const existing = await prisma.project.findFirst({ where: { id: projectId, ...(await projectAccessFilter(req.userId as string)) } });

    if (!existing) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    await assertCanManageProject(req.userId as string, existing);

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        gitlabConnectionId: String(connectionId),
        gitlabProjectId: Number(gitlabProjectId),
        gitlabRepo: String(repoFullPath),
        gitlabBranch: String(branch),
      },
    });

    res.json({ project });
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de l'association GitLab du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible d'associer le dépôt GitLab à ce projet." });
  }
});
