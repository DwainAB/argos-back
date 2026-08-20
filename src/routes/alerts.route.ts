import { Router } from "express";
import { prisma } from "../lib/prisma";

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
