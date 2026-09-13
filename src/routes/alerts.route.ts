import { Router } from "express";
import { prisma } from "../lib/prisma";
import { suggestFix } from "../services/fix-suggestion.service";
import { createFixPullRequest } from "../services/github-pr.service";
import { projectAccessFilter } from "../services/project-access.service";
import { getSubscriptionForRequestingUser, tryConsumeFixQuota } from "../services/subscription.service";

export const alertsRouter = Router();

alertsRouter.get("/api/projects/:projectId/alerts", async (req, res) => {
  const { projectId } = req.params;
  const resolved = req.query.resolved === "true";

  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ...await projectAccessFilter(req.userId as string) } });

    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const alerts = await prisma.alert.findMany({
      where: {
        logEntry: { projectId },
        resolvedAt: resolved ? { not: null } : null,
      },
      include: { logEntry: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ alerts });
  } catch (err) {
    console.error(`Erreur lors de la récupération des alertes du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer les alertes." });
  }
});

alertsRouter.get("/api/alerts/:alertId", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findFirst({
      where: { id: alertId, logEntry: { project: await projectAccessFilter(req.userId as string) } },
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

alertsRouter.post("/api/alerts/:alertId/resolve", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findFirst({
      where: { id: alertId, logEntry: { project: await projectAccessFilter(req.userId as string) } },
    });

    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable." });
    }

    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: { resolvedAt: new Date() },
      include: { logEntry: true },
    });

    res.json({ alert: updated });
  } catch (err) {
    console.error(`Erreur lors du marquage comme traitée de l'alerte ${alertId} :`, err);
    res.status(500).json({ error: "Impossible de marquer cette alerte comme traitée." });
  }
});

alertsRouter.post("/api/alerts/:alertId/reopen", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findFirst({
      where: { id: alertId, logEntry: { project: await projectAccessFilter(req.userId as string) } },
    });

    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable." });
    }

    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: { resolvedAt: null },
      include: { logEntry: true },
    });

    res.json({ alert: updated });
  } catch (err) {
    console.error(`Erreur lors de la réouverture de l'alerte ${alertId} :`, err);
    res.status(500).json({ error: "Impossible de rouvrir cette alerte." });
  }
});

alertsRouter.post("/api/alerts/:alertId/fix/request", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findFirst({
      where: { id: alertId, logEntry: { project: await projectAccessFilter(req.userId as string) } },
      include: { logEntry: { include: { project: true } } },
    });

    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable." });
    }

    const { project } = alert.logEntry;

    if (!project.githubInstallationId || !project.githubRepo || !project.githubBranch) {
      return res.status(422).json({ error: "Ce projet n'a pas de dépôt GitHub connecté." });
    }

    const subscription = await getSubscriptionForRequestingUser(req.userId as string);
    if (subscription) {
      const requestingUser = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
      const allowed = await tryConsumeFixQuota(subscription, requestingUser?.email ?? "");
      if (!allowed) {
        return res.status(429).json({ error: "Quota mensuel de corrections IA atteint pour votre abonnement." });
      }
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
        proposedExplanation: suggestion.explanation,
      },
      include: { logEntry: true },
    });

    res.json({ alert: updated });
  } catch (err) {
    console.error(`Erreur lors de la demande de correction pour l'alerte ${alertId} :`, err);
    res.status(502).json({ error: "Impossible d'obtenir une proposition de correction." });
  }
});

alertsRouter.post("/api/alerts/:alertId/fix/accept", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findFirst({
      where: { id: alertId, logEntry: { project: await projectAccessFilter(req.userId as string) } },
      include: { logEntry: { include: { project: true } } },
    });

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
      explanation: alert.proposedExplanation ?? alert.explanation,
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

alertsRouter.post("/api/alerts/:alertId/fix/reject", async (req, res) => {
  const { alertId } = req.params;

  try {
    const alert = await prisma.alert.findFirst({
      where: { id: alertId, logEntry: { project: await projectAccessFilter(req.userId as string) } },
    });

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
