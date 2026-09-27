import { Router } from "express";
import { prisma } from "../lib/prisma";
import { suggestFix } from "../services/code-analysis/fix-suggestion.service";
import { createFixChangeRequest } from "../services/code-analysis/fix-change-request.service";
import { buildCodeSource } from "../services/code-analysis/code-analysis.service";
import { projectAccessFilter } from "../services/organization/project-access.service";
import { getSubscriptionForRequestingUser, tryConsumeFixQuota, consumeFixQuota } from "../services/billing/subscription.service";

export const alertsRouter = Router();

// Nombre d'erreurs et d'avertissements (dernières 24h) par projet accessible à
// l'utilisateur, pour le graphique comparatif de la vue d'ensemble (quels projets
// causent le plus de problèmes).
alertsRouter.get("/api/projects/alerts-summary", async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: await projectAccessFilter(req.userId as string),
      select: { id: true, name: true },
    });

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const logs = await prisma.logEntry.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        createdAt: { gte: since24h },
        category: { in: ["critical", "warning"] },
      },
      select: { projectId: true, category: true },
    });

    const countsByProject = new Map<string, { errorCount: number; warningCount: number }>();
    for (const log of logs) {
      const counts = countsByProject.get(log.projectId) ?? { errorCount: 0, warningCount: 0 };
      if (log.category === "critical") counts.errorCount++;
      else counts.warningCount++;
      countsByProject.set(log.projectId, counts);
    }

    const summary = projects
      .map((project) => {
        const counts = countsByProject.get(project.id) ?? { errorCount: 0, warningCount: 0 };
        return { projectId: project.id, projectName: project.name, ...counts };
      })
      .sort((a, b) => b.errorCount + b.warningCount - (a.errorCount + a.warningCount));

    res.json({ summary });
  } catch (err) {
    console.error("Erreur lors de la récupération du résumé des alertes par projet :", err);
    res.status(500).json({ error: "Impossible de récupérer le résumé des alertes." });
  }
});

alertsRouter.get("/api/projects/:projectId/alerts", async (req, res) => {
  const { projectId } = req.params;
  const resolved = req.query.resolved === "true";

  // limit/offset sont optionnels : sans eux, on renvoie tout (utilisé par ex. pour le badge de la sidebar).
  const hasLimit = req.query.limit !== undefined;
  const limit = hasLimit ? Math.min(Math.max(Number(req.query.limit) || 10, 1), 100) : undefined;
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ...await projectAccessFilter(req.userId as string) } });

    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const where = {
      logEntry: { projectId },
      resolvedAt: resolved ? { not: null } : null,
    };

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: { logEntry: true },
        orderBy: { createdAt: "desc" },
        ...(hasLimit ? { take: limit, skip: offset } : {}),
      }),
      prisma.alert.count({ where }),
    ]);

    res.json({ alerts, total });
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

    if (alert.fixLocation !== "code") {
      return res.status(422).json({
        error: "Ce problème ne se corrige pas dans le code — suivez les instructions données dans l'explication de l'alerte.",
      });
    }

    const { project } = alert.logEntry;

    const source = buildCodeSource(project);
    if (!source) {
      return res.status(422).json({ error: "Ce projet n'a pas de dépôt GitHub ou GitLab connecté." });
    }

    const subscription = await getSubscriptionForRequestingUser(req.userId as string);
    if (subscription) {
      const requestingUser = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
      const allowed = await tryConsumeFixQuota(subscription, requestingUser?.email ?? "");
      if (!allowed) {
        return res.status(429).json({ error: "Quota mensuel de corrections IA atteint pour votre abonnement." });
      }
    }

    const suggestion = await suggestFix(source, alert.logEntry.rawMessage);

    if (!suggestion) {
      return res.status(422).json({ error: "L'IA n'a pas pu proposer de correctif fiable pour cette alerte." });
    }

    // Le quota n'est consommé qu'à ce stade, une fois la correction effectivement obtenue —
    // ni un report_no_fix ni une exception (ex: erreur d'exploration du dépôt) ne doivent
    // coûter de quota pour un correctif jamais livré.
    if (subscription) {
      await consumeFixQuota(subscription.id);
    }

    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: "fix_proposed",
        proposedFilePath: suggestion.filePath,
        proposedOldCode: suggestion.oldCode,
        proposedNewCode: suggestion.newCode,
        proposedExplanation: suggestion.explanation,
        proposedCommitMessage: suggestion.commitMessage,
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

    if (!buildCodeSource(project)) {
      return res.status(422).json({ error: "Ce projet n'a pas de dépôt GitHub ou GitLab connecté." });
    }

    // Le message de commit édité par l'utilisateur (s'il en a fourni un) prime sur celui
    // proposé par défaut par l'IA — voir proposedCommitMessage, éditable côté frontend avant
    // validation.
    const { commitMessage } = req.body ?? {};
    const finalCommitMessage =
      typeof commitMessage === "string" && commitMessage.trim()
        ? commitMessage.trim()
        : (alert.proposedCommitMessage ?? `fix: ${alert.proposedFilePath}`);

    const pullRequestUrl = await createFixChangeRequest(project, {
      filePath: alert.proposedFilePath,
      oldCode: alert.proposedOldCode,
      newCode: alert.proposedNewCode,
      explanation: alert.proposedExplanation ?? alert.explanation,
      commitMessage: finalCommitMessage,
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
