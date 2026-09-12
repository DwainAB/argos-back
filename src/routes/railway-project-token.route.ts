import { Router } from "express";
import { prisma } from "../lib/prisma";
import { fetchLatestDeploymentLogsWithProjectToken } from "../services/railway-project-token.service";
import { startLogStreamForProject } from "../services/railway-log-stream.service";
import { getMembershipForUser } from "../services/organization.service";
import { SOLO_PROJECT_LIMIT } from "../services/subscription.service";

export const railwayProjectTokenRouter = Router();

railwayProjectTokenRouter.post("/api/integrations/railway/connect-with-token", async (req, res) => {
  const { projectToken, serviceId, environmentId, projectName } = req.body ?? {};

  if (!projectToken || !serviceId || !environmentId) {
    return res.status(400).json({ error: "projectToken, serviceId et environmentId sont requis." });
  }

  const membership = await getMembershipForUser(req.userId as string);
  if (membership && membership.role !== "admin") {
    return res.status(403).json({ error: "Seul un administrateur de l'organisation peut ajouter un projet." });
  }

  if (!membership) {
    const activeProjectCount = await prisma.project.count({
      where: { userId: req.userId as string, archivedAt: null },
    });
    if (activeProjectCount >= SOLO_PROJECT_LIMIT) {
      return res.status(422).json({
        error: `Le plan Solo est limité à ${SOLO_PROJECT_LIMIT} projets. Passez au plan Business pour en ajouter davantage.`,
      });
    }
  }

  try {
    const logs = await fetchLatestDeploymentLogsWithProjectToken(projectToken, { serviceId, environmentId });

    const project = await prisma.project.create({
      data: {
        name: projectName || "Projet Railway sans nom",
        railwayProjectToken: projectToken,
        railwayServiceId: serviceId,
        railwayEnvironmentId: environmentId,
        userId: req.userId as string,
        organizationId: membership?.organizationId,
      },
    });

    startLogStreamForProject({
      id: project.id,
      railwayProjectToken: projectToken,
      railwayServiceId: serviceId,
      railwayEnvironmentId: environmentId,
    }).catch((err) => console.error(`Échec du démarrage du streaming pour le projet ${project.id} :`, err));

    res.json({ project, logs });
  } catch (err) {
    console.error("Erreur lors de la connexion Railway via Project Token :", err);
    res.status(502).json({
      error: "Impossible de récupérer les logs. Vérifiez le token, le Service ID et l'Environment ID.",
    });
  }
});
