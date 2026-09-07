import { Router } from "express";
import { prisma } from "../lib/prisma";
import { fetchLatestDeployment } from "../services/railway-project-token.service";
import { explainLog } from "../services/log-explanation.service";
import { projectAccessFilter } from "../services/project-access.service";
import { assertCanManageProject, OrganizationError } from "../services/organization.service";

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
    const project = await prisma.project.findFirst({ where: { id: projectId, ...await projectAccessFilter(req.userId as string) } });

    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [errorCount, warningCount] = await Promise.all([
      prisma.logEntry.count({ where: { projectId, category: "critical", createdAt: { gte: since24h } } }),
      prisma.logEntry.count({ where: { projectId, category: "warning", createdAt: { gte: since24h } } }),
    ]);

    let latestDeployment = null;
    if (project.railwayProjectToken && project.railwayServiceId && project.railwayEnvironmentId) {
      try {
        latestDeployment = await fetchLatestDeployment(project.railwayProjectToken, {
          serviceId: project.railwayServiceId,
          environmentId: project.railwayEnvironmentId,
        });
      } catch (err) {
        console.error(`Impossible de récupérer le dernier déploiement du projet ${projectId} :`, err);
      }
    }

    res.json({ latestDeployment, errorCount, warningCount });
  } catch (err) {
    console.error(`Erreur lors de la récupération de l'aperçu du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer l'aperçu du projet." });
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
        createdAt: true,
        railwayServiceId: true,
        railwayEnvironmentId: true,
        user: { select: { accountType: true, organizationName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ projects });
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
        createdAt: true,
        railwayServiceId: true,
        railwayEnvironmentId: true,
        user: { select: { accountType: true, organizationName: true } },
      },
    });

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
