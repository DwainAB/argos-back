import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  buildGithubInstallUrl,
  listInstallationRepos,
  listRepoBranches,
} from "../services/github-app.service";

export const githubIntegrationRouter = Router();

const STATE_COOKIE = "github_install_state";
const TEMP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 10 * 60 * 1000,
};

// GET /api/integrations/github/start?projectId=...
// Redirige l'utilisateur vers la page d'installation de la GitHub App Guardian AI.
// Le projectId cible est encodé dans le "state" pour être restitué après l'installation
// (GitHub ne permet pas de le faire transiter autrement dans ce flux).
githubIntegrationRouter.get("/api/integrations/github/start", (req, res) => {
  const projectId = String(req.query.projectId ?? "");
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${nonce}.${projectId}`;

  res.cookie(STATE_COOKIE, nonce, TEMP_COOKIE_OPTIONS);
  res.redirect(buildGithubInstallUrl(state));
});

// GET /api/integrations/github/callback
// GitHub redirige ici une fois l'installation terminée, avec installation_id et setup_action.
// On renvoie l'utilisateur vers la page des paramètres du projet concerné, avec
// l'installation_id en query param pour que le front affiche le choix du repo/branche.
githubIntegrationRouter.get("/api/integrations/github/callback", (req, res) => {
  const { installation_id, setup_action, state } = req.query;

  const expectedNonce = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  const [nonce, projectId] = String(state ?? "").split(".");
  const fallbackUrl = `${env.frontendUrl}/dashboard/projects`;
  const targetUrl = projectId ? `${env.frontendUrl}/dashboard/projects/${projectId}/settings` : fallbackUrl;

  if (setup_action !== "install" || !installation_id) {
    return res.redirect(`${targetUrl}?github_error=installation_failed`);
  }

  if (!nonce || nonce !== expectedNonce) {
    return res.redirect(`${targetUrl}?github_error=invalid_state`);
  }

  res.redirect(`${targetUrl}?github_installation_id=${installation_id}`);
});

// GET /api/integrations/github/repos?installationId=...
// Liste les repos accessibles pour une installation donnée.
githubIntegrationRouter.get("/api/integrations/github/repos", async (req, res) => {
  const installationId = Number(req.query.installationId);

  if (!installationId) {
    return res.status(400).json({ error: "installationId requis." });
  }

  try {
    const repos = await listInstallationRepos(installationId);
    res.json({ repos });
  } catch (err) {
    console.error("Erreur lors de la récupération des repos GitHub :", err);
    res.status(502).json({ error: "Impossible de récupérer les dépôts GitHub." });
  }
});

// GET /api/integrations/github/branches?installationId=...&owner=...&repo=...
// Liste les branches d'un repo précis.
githubIntegrationRouter.get("/api/integrations/github/branches", async (req, res) => {
  const installationId = Number(req.query.installationId);
  const owner = String(req.query.owner ?? "");
  const repo = String(req.query.repo ?? "");

  if (!installationId || !owner || !repo) {
    return res.status(400).json({ error: "installationId, owner et repo sont requis." });
  }

  try {
    const branches = await listRepoBranches(installationId, { owner, repo });
    res.json({ branches });
  } catch (err) {
    console.error("Erreur lors de la récupération des branches GitHub :", err);
    res.status(502).json({ error: "Impossible de récupérer les branches." });
  }
});

// POST /api/projects/:projectId/github
// Associe un dépôt GitHub (et sa branche) à un projet Guardian AI existant.
githubIntegrationRouter.post("/api/projects/:projectId/github", async (req, res) => {
  const { projectId } = req.params;
  const { installationId, repoFullName, branch } = req.body ?? {};

  if (!installationId || !repoFullName || !branch) {
    return res.status(400).json({ error: "installationId, repoFullName et branch sont requis." });
  }

  try {
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        githubInstallationId: Number(installationId),
        githubRepo: repoFullName,
        githubBranch: branch,
      },
    });

    res.json({ project });
  } catch (err) {
    console.error(`Erreur lors de l'association GitHub du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible d'associer le dépôt GitHub à ce projet." });
  }
});
