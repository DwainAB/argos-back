import { Router } from "express";
import { prisma } from "../lib/prisma";
import { fetchLatestDeployment } from "../services/railway-project-token.service";

export const logsRouter = Router();

// GET /api/projects/:projectId/logs
// Renvoie les logs stockés en base pour un projet, du plus récent au plus ancien.
logsRouter.get("/api/projects/:projectId/logs", async (req, res) => {
  const { projectId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  try {
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

// GET /api/projects/:projectId/overview
// Statistiques affichées sur la page d'aperçu du projet : dernier déploiement (Railway,
// à la demande) et compteurs d'erreurs/avertissements sur les dernières 24h (base locale).
logsRouter.get("/api/projects/:projectId/overview", async (req, res) => {
  const { projectId } = req.params;

  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } });

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

// GET /api/projects
// Liste les projets connectés (utilisateur de test unique pour l'instant).
logsRouter.get("/api/projects", async (_req, res) => {
  try {
    const projects = await prisma.project.findMany({
      select: {
        id: true,
        name: true,
        githubRepo: true,
        githubBranch: true,
        createdAt: true,
        railwayServiceId: true,
        railwayEnvironmentId: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ projects });
  } catch (err) {
    console.error("Erreur lors de la récupération des projets :", err);
    res.status(500).json({ error: "Impossible de récupérer les projets." });
  }
});
