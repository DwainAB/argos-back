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

// Routes /start et /callback à part : elles sont accessibles sans authMiddleware (voir
// app.ts) car appelées par une navigation directe du navigateur (popup ouvert via
// window.open, puis redirection depuis github.com) et non par un fetch avec le cookie de
// session applicatif. L'appartenance au bon projet reste garantie ailleurs : le state
// signé encode le projectId, et POST /api/projects/:projectId/github (qui associe
// réellement le dépôt) reste protégée et filtrée par userId.
export const githubPublicRouter = Router();
export const githubIntegrationRouter = Router();

const STATE_COOKIE = "github_install_state";
const TEMP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 10 * 60 * 1000,
};

// GET /api/integrations/github/start?projectId=...
// Redirige vers la page d'installation de la GitHub App Argos AI. Appelée dans un popup
// ouvert par le front (voir GithubConnectButton) : le résultat revient via postMessage
// depuis /callback ci-dessous, pas par redirection de page.
githubPublicRouter.get("/api/integrations/github/start", (req, res) => {
  const projectId = String(req.query.projectId ?? "");
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${nonce}.${projectId}`;

  res.cookie(STATE_COOKIE, nonce, TEMP_COOKIE_OPTIONS);
  res.redirect(buildGithubInstallUrl(state));
});

// Petite page HTML servie au popup GitHub une fois l'installation (ou sa mise à jour)
// terminée : transmet le résultat à la fenêtre d'origine via postMessage puis se ferme,
// plutôt que de rediriger le popup lui-même vers le dashboard (voir /callback ci-dessous).
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

// GET /api/integrations/github/callback
// GitHub redirige ici une fois l'installation (ou sa mise à jour, y compris quand l'app
// était déjà installée — voir "Redirect on update" côté settings de la GitHub App) terminée,
// avec installation_id et setup_action. Le popup ouvert par le front se ferme ensuite de
// lui-même après avoir transmis le résultat à la fenêtre d'origine (voir GithubConnectButton
// côté frontend).
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

// GET /api/integrations/github/installations
// Liste les installations existantes de la GitHub App. Permet au front de proposer d'en
// réutiliser une plutôt que de repasser par le flux GitHub (qui, une fois l'app déjà
// installée sur le compte choisi, ne redirige jamais vers notre callback — voir
// GithubConnectButton côté frontend).
githubIntegrationRouter.get("/api/integrations/github/installations", async (_req, res) => {
  try {
    const installations = await listAppInstallations();
    res.json({ installations });
  } catch (err) {
    console.error("Erreur lors de la récupération des installations GitHub :", err);
    res.status(502).json({ error: "Impossible de récupérer les installations GitHub." });
  }
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
