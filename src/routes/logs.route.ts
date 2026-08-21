import { Router } from "express";
import { prisma } from "../lib/prisma";
import { fetchLatestDeployment } from "../services/railway-project-token.service";
import { explainLog } from "../services/log-explanation.service";

export const logsRouter = Router();

// POST /api/logs/:logEntryId/explain
// Explique un log en langage clair, à la demande (bouton "Explication" sur un log dans
// l'interface). Si une explication existe déjà (aiSummary, remplie automatiquement pour
// les logs critical/warning par le triage, voir log-triage.service.ts), elle est
// renvoyée telle quelle sans rappeler l'IA (réponse JSON classique, immédiate). Sinon,
// l'IA locale est interrogée et streamée au client au fil du texte généré (réponse
// chunked en texte brut, pas de JSON) pour que l'explication s'affiche progressivement
// au lieu d'attendre la fin de la génération. Le résultat complet est sauvegardé sur le
// log une fois le stream terminé, pour les prochaines consultations.
logsRouter.post("/api/logs/:logEntryId/explain", async (req, res) => {
  const { logEntryId } = req.params;

  try {
    const logEntry = await prisma.logEntry.findUnique({ where: { id: logEntryId } });

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

// PATCH /api/projects/:projectId
// Met à jour les informations générales d'un projet (pour l'instant, uniquement le nom).
logsRouter.patch("/api/projects/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const { name } = req.body;

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Le nom du projet est requis." });
  }

  try {
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
      },
    });

    res.json({ project });
  } catch (err) {
    console.error(`Erreur lors de la mise à jour du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de mettre à jour le projet." });
  }
});
