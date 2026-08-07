import { Router } from "express";
import { prisma } from "../lib/prisma";

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
