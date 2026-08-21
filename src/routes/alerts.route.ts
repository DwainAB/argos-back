import { Router } from "express";
import { prisma } from "../lib/prisma";
import { suggestFix } from "../services/fix-suggestion.service";
import { createFixPullRequest } from "../services/github-pr.service";

export const alertsRouter = Router();

// GET /api/projects/:projectId/alerts
// Liste les alertes d'un projet (logs confirmés comme de vrais problèmes par le triage
// IA, voir backend/src/services/log-triage.service.ts), du plus récent au plus ancien.
alertsRouter.get("/api/projects/:projectId/alerts", async (req, res) => {
  const { projectId } = req.params;

  try {
    const alerts = await prisma.alert.findMany({
      where: { logEntry: { projectId } },
      include: { logEntry: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ alerts });
  } catch (err) {
    console.error(`Erreur lors de la récupération des alertes du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer les alertes." });
  }
});

// GET /api/alerts/:alertId
// Détail d'une alerte précise, avec son log d'origine — page dédiée à une alerte.
alertsRouter.get("/api/alerts/:alertId", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: { logEntry: true },
    });

    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable." });
    }

    res.json({ alert });
  } catch (err) {
    console.error(`Erreur lors de la récupération de l'alerte ${alertId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer l'alerte." });
  }
});

// POST /api/alerts/:alertId/fix/request
// Déclenche la proposition de correctif par l'IA distante (bouton "Demander une
// correction par IA"). Explore le repo GitHub associé au projet, propose un diff
// avant/après si une cause fiable est identifiée, et passe l'alerte en "fix_proposed".
alertsRouter.post("/api/alerts/:alertId/fix/request", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findUnique({ where: { id: alertId }, include: { logEntry: { include: { project: true } } } });

    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable." });
    }

    const { project } = alert.logEntry;

    if (!project.githubInstallationId || !project.githubRepo || !project.githubBranch) {
      return res.status(422).json({ error: "Ce projet n'a pas de dépôt GitHub connecté." });
    }

    const [owner, repo] = project.githubRepo.split("/");

    const suggestion = await suggestFix({
      installationId: project.githubInstallationId,
      owner,
      repo,
      ref: project.githubBranch,
      logMessage: alert.logEntry.rawMessage,
    });

    if (!suggestion) {
      return res.status(422).json({ error: "L'IA n'a pas pu proposer de correctif fiable pour cette alerte." });
    }

    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: "fix_proposed",
        proposedFilePath: suggestion.filePath,
        proposedOldCode: suggestion.oldCode,
        proposedNewCode: suggestion.newCode,
      },
      include: { logEntry: true },
    });

    res.json({ alert: updated, explanation: suggestion.explanation });
  } catch (err) {
    console.error(`Erreur lors de la demande de correction pour l'alerte ${alertId} :`, err);
    res.status(502).json({ error: "Impossible d'obtenir une proposition de correction." });
  }
});

// POST /api/alerts/:alertId/fix/accept
// L'utilisateur valide le correctif proposé : ouvre réellement la pull request sur
// GitHub. Ne merge jamais automatiquement — l'utilisateur décide ensuite sur GitHub.
alertsRouter.post("/api/alerts/:alertId/fix/accept", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findUnique({ where: { id: alertId }, include: { logEntry: { include: { project: true } } } });

    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable." });
    }

    if (alert.status !== "fix_proposed" || !alert.proposedFilePath || !alert.proposedOldCode || !alert.proposedNewCode) {
      return res.status(422).json({ error: "Aucun correctif proposé en attente pour cette alerte." });
    }

    const { project } = alert.logEntry;

    if (!project.githubInstallationId || !project.githubRepo || !project.githubBranch) {
      return res.status(422).json({ error: "Ce projet n'a pas de dépôt GitHub connecté." });
    }

    const [owner, repo] = project.githubRepo.split("/");

    const pullRequestUrl = await createFixPullRequest({
      installationId: project.githubInstallationId,
      owner,
      repo,
      baseBranch: project.githubBranch,
      filePath: alert.proposedFilePath,
      oldCode: alert.proposedOldCode,
      newCode: alert.proposedNewCode,
      explanation: alert.explanation,
    });

    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: { status: "fix_accepted", pullRequestUrl },
      include: { logEntry: true },
    });

    res.json({ alert: updated });
  } catch (err) {
    console.error(`Erreur lors de la création de la pull request pour l'alerte ${alertId} :`, err);
    res.status(502).json({ error: "Impossible de créer la pull request." });
  }
});

// POST /api/alerts/:alertId/fix/reject
// L'utilisateur refuse le correctif proposé : le correctif reste affiché tel quel, sans
// pull request créée.
alertsRouter.post("/api/alerts/:alertId/fix/reject", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });

    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable." });
    }

    if (alert.status !== "fix_proposed") {
      return res.status(422).json({ error: "Aucun correctif proposé en attente pour cette alerte." });
    }

    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: { status: "fix_rejected" },
      include: { logEntry: true },
    });

    res.json({ alert: updated });
  } catch (err) {
    console.error(`Erreur lors du refus du correctif pour l'alerte ${alertId} :`, err);
    res.status(500).json({ error: "Impossible de refuser le correctif." });
  }
});
