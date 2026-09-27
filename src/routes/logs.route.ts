import { Router } from "express";
import { prisma } from "../lib/prisma";
import { fetchLatestDeployment as fetchLatestRailwayDeployment } from "../services/providers/railway/railway-project-token.service";
import { fetchLatestDeployment as fetchLatestRenderDeployment } from "../services/providers/render/render-api.service";
import { decryptSecret } from "../lib/encryption";
import { explainLog } from "../services/logs/log-explanation.service";
import { projectAccessFilter } from "../services/organization/project-access.service";
import { assertCanManageProject, OrganizationError } from "../services/organization/organization.service";
import { logActivity, getLastActors, ACTIVITY_ACTIONS } from "../services/activity/activity-log.service";

export const logsRouter = Router();

logsRouter.post("/api/logs/:logEntryId/explain", async (req, res) => {
  const { logEntryId } = req.params;

  try {
    const logEntry = await prisma.logEntry.findFirst({
      where: { id: logEntryId, project: await projectAccessFilter(req.userId as string) },
    });

    if (!logEntry) {
      return res.status(404).json({ error: "Log introuvable." });
    }

    if (logEntry.aiSummary) {
      return res.json({ explanation: logEntry.aiSummary, cached: true });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const explanation = await explainLog({ level: logEntry.level, message: logEntry.rawMessage }, (chunk) => {
      res.write(chunk);
    });

    await prisma.logEntry.update({ where: { id: logEntryId }, data: { aiSummary: explanation } });

    res.end();
  } catch (err) {
    console.error(`Erreur lors de l'explication du log ${logEntryId} :`, err);
    if (res.headersSent) {
      res.end();
    } else {
      res.status(502).json({ error: "Impossible d'obtenir une explication pour ce log." });
    }
  }
});

logsRouter.get("/api/projects/:projectId/logs", async (req, res) => {
  const { projectId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ...await projectAccessFilter(req.userId as string) } });

    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const logs = await prisma.logEntry.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json({ logs });
  } catch (err) {
    console.error(`Erreur lors de la récupération des logs du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer les logs." });
  }
});

logsRouter.get("/api/projects/:projectId/overview", async (req, res) => {
  const { projectId } = req.params;

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, ...await projectAccessFilter(req.userId as string) },
      include: { renderApiKeyRef: true },
    });

    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [errorCount, warningCount] = await Promise.all([
      prisma.logEntry.count({ where: { projectId, category: "critical", createdAt: { gte: since24h } } }),
      prisma.logEntry.count({ where: { projectId, category: "warning", createdAt: { gte: since24h } } }),
    ]);

    let latestDeployment = null;
    try {
      if (project.railwayProjectToken && project.railwayServiceId && project.railwayEnvironmentId) {
        latestDeployment = await fetchLatestRailwayDeployment(project.railwayProjectToken, {
          serviceId: project.railwayServiceId,
          environmentId: project.railwayEnvironmentId,
        });
      } else if (project.renderApiKeyRef && project.renderResourceId) {
        latestDeployment = await fetchLatestRenderDeployment(decryptSecret(project.renderApiKeyRef.encryptedKey), {
          resourceId: project.renderResourceId,
        });
      }
    } catch (err) {
      console.error(`Impossible de récupérer le dernier déploiement du projet ${projectId} :`, err);
    }

    res.json({ latestDeployment, errorCount, warningCount });
  } catch (err) {
    console.error(`Erreur lors de la récupération de l'aperçu du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer l'aperçu du projet." });
  }
});

type TimeseriesRange = "24h" | "7d" | "30d";

// Calcule les bornes des buckets pour une plage donnée : 24 buckets d'1h pour "24h",
// 7 buckets d'1j pour "7d", 30 buckets d'1j pour "30d".
function buildBuckets(range: TimeseriesRange) {
  const now = new Date();
  const bucketMs = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const bucketCount = range === "24h" ? 24 : range === "7d" ? 7 : 30;

  // Aligne la borne de fin sur le bucket courant (haut de l'heure ou du jour).
  const end = new Date(Math.ceil(now.getTime() / bucketMs) * bucketMs);

  const buckets: { start: Date; end: Date }[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    const bucketEnd = new Date(end.getTime() - i * bucketMs);
    const bucketStart = new Date(bucketEnd.getTime() - bucketMs);
    buckets.push({ start: bucketStart, end: bucketEnd });
  }

  return buckets;
}

logsRouter.get("/api/projects/:projectId/timeseries", async (req, res) => {
  const { projectId } = req.params;
  const range = (["24h", "7d", "30d"].includes(req.query.range as string) ? req.query.range : "24h") as TimeseriesRange;

  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ...await projectAccessFilter(req.userId as string) } });

    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const buckets = buildBuckets(range);

    const entries = await prisma.logEntry.findMany({
      where: { projectId, createdAt: { gte: buckets[0].start } },
      select: { createdAt: true, category: true },
    });

    const points = buckets.map(({ start, end }) => {
      const inBucket = entries.filter((e) => e.createdAt >= start && e.createdAt < end);
      return {
        timestamp: start.toISOString(),
        errorCount: inBucket.filter((e) => e.category === "critical").length,
        warningCount: inBucket.filter((e) => e.category === "warning").length,
      };
    });

    res.json({ range, points });
  } catch (err) {
    console.error(`Erreur lors de la récupération de la série temporelle du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer la série temporelle." });
  }
});

logsRouter.get("/api/projects", async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: await projectAccessFilter(req.userId as string),
      select: {
        id: true,
        name: true,
        githubRepo: true,
        githubBranch: true,
        gitlabRepo: true,
        gitlabBranch: true,
        createdAt: true,
        railwayServiceId: true,
        railwayEnvironmentId: true,
        renderOwnerId: true,
        renderResourceId: true,
        user: { select: { accountType: true, organizationName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const createdByActors = await getLastActors(
      "Project",
      projects.map((p) => p.id),
      ACTIVITY_ACTIONS.PROJECT_CREATED
    );
    const projectsWithActors = projects.map((p) => ({ ...p, createdBy: createdByActors.get(p.id) ?? null }));

    res.json({ projects: projectsWithActors });
  } catch (err) {
    console.error("Erreur lors de la récupération des projets :", err);
    res.status(500).json({ error: "Impossible de récupérer les projets." });
  }
});

logsRouter.patch("/api/projects/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const { name } = req.body;

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Le nom du projet est requis." });
  }

  try {
    const existing = await prisma.project.findFirst({ where: { id: projectId, ...await projectAccessFilter(req.userId as string) } });

    if (!existing) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    await assertCanManageProject(req.userId as string, existing);

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { name: name.trim() },
      select: {
        id: true,
        name: true,
        githubRepo: true,
        githubBranch: true,
        gitlabRepo: true,
        gitlabBranch: true,
        createdAt: true,
        railwayServiceId: true,
        railwayEnvironmentId: true,
        renderOwnerId: true,
        renderResourceId: true,
        user: { select: { accountType: true, organizationName: true } },
      },
    });

    if (existing.name !== project.name) {
      await logActivity({
        userId: req.userId as string,
        action: ACTIVITY_ACTIONS.PROJECT_RENAMED,
        entityType: "Project",
        entityId: projectId,
        projectId,
        metadata: { previousName: existing.name, newName: project.name },
      });
    }

    res.json({ project });
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de la mise à jour du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de mettre à jour le projet." });
  }
});

logsRouter.delete("/api/projects/:projectId", async (req, res) => {
  const { projectId } = req.params;

  try {
    const existing = await prisma.project.findFirst({ where: { id: projectId, ...(await projectAccessFilter(req.userId as string)) } });

    if (!existing) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    await assertCanManageProject(req.userId as string, existing);

    // Journalisé avant la suppression effective : entityId reste valide dans l'historique
    // même une fois le projet supprimé (ActivityLog.projectId passe à null via onDelete:
    // SetNull, mais l'entrée elle-même — et son entityId — persiste).
    await logActivity({
      userId: req.userId as string,
      action: ACTIVITY_ACTIONS.PROJECT_DELETED,
      entityType: "Project",
      entityId: projectId,
      projectId,
      metadata: { name: existing.name },
    });

    await prisma.project.delete({ where: { id: projectId } });

    res.status(204).end();
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de la suppression du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de supprimer le projet." });
  }
});
