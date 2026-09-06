import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  buildGithubInstallUrl,
  listAppInstallations,
  listInstallationRepos,
  listRepoBranches,
} from "../services/github-app.service";
import { projectAccessFilter } from "../services/project-access.service";

export const githubPublicRouter = Router();
export const githubIntegrationRouter = Router();

const STATE_COOKIE = "github_install_state";
const TEMP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 10 * 60 * 1000,
};

githubPublicRouter.get("/api/integrations/github/start", (req, res) => {
  const projectId = String(req.query.projectId ?? "");
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${nonce}.${projectId}`;

  res.cookie(STATE_COOKIE, nonce, TEMP_COOKIE_OPTIONS);
  res.redirect(buildGithubInstallUrl(state));
});

function renderPostMessagePage(payload: Record<string, unknown>) {
  return `<!doctype html>
<html><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify({ source: "argos-github-install", ...payload })}, ${JSON.stringify(env.frontendUrl)});
  }
  window.close();
</script>
</body></html>`;
}

githubPublicRouter.get("/api/integrations/github/callback", (req, res) => {
  const { installation_id, setup_action, state } = req.query;

  const expectedNonce = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  const [nonce, projectId] = String(state ?? "").split(".");

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if ((setup_action !== "install" && setup_action !== "update") || !installation_id) {
    return res.send(renderPostMessagePage({ error: "installation_failed" }));
  }

  if (!nonce || nonce !== expectedNonce) {
    return res.send(renderPostMessagePage({ error: "invalid_state" }));
  }

  res.send(renderPostMessagePage({ installationId: String(installation_id), projectId: projectId || null }));
});

githubIntegrationRouter.get("/api/integrations/github/installations", async (_req, res) => {
  try {
    const installations = await listAppInstallations();
    res.json({ installations });
  } catch (err) {
    console.error("Erreur lors de la récupération des installations GitHub :", err);
    res.status(502).json({ error: "Impossible de récupérer les installations GitHub." });
  }
});

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

githubIntegrationRouter.post("/api/projects/:projectId/github", async (req, res) => {
  const { projectId } = req.params;
  const { installationId, repoFullName, branch } = req.body ?? {};

  if (!installationId || !repoFullName || !branch) {
    return res.status(400).json({ error: "installationId, repoFullName et branch sont requis." });
  }

  try {
    const existing = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessFilter(req.userId as string) } });

    if (!existing) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

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
