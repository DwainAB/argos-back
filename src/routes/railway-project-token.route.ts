import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getOrCreateDefaultUser } from "../services/default-user.service";
import { fetchLatestDeploymentLogsWithProjectToken } from "../services/railway-project-token.service";
import { startLogStreamForProject } from "../services/railway-log-stream.service";

export const railwayProjectTokenRouter = Router();

// POST /api/integrations/railway/connect-with-token
// Connexion manuelle via Project Token Railway (solution retenue en attendant la résolution
// du problème avec l'OAuth "Login with Railway", voir railway-integration.route.ts).
// Reçoit le token + serviceId + environmentId : valide la connexion en récupérant les logs
// une première fois, persiste le projet en base, puis démarre le streaming temps réel.
railwayProjectTokenRouter.post("/api/integrations/railway/connect-with-token", async (req, res) => {
  const { projectToken, serviceId, environmentId, projectName } = req.body ?? {};

  if (!projectToken || !serviceId || !environmentId) {
    return res.status(400).json({ error: "projectToken, serviceId et environmentId sont requis." });
  }

  try {
    const logs = await fetchLatestDeploymentLogsWithProjectToken(projectToken, { serviceId, environmentId });

    const user = await getOrCreateDefaultUser();

    const project = await prisma.project.create({
      data: {
        name: projectName || "Projet Railway sans nom",
        railwayProjectToken: projectToken,
        railwayServiceId: serviceId,
        railwayEnvironmentId: environmentId,
        userId: user.id,
      },
    });

    // Démarrage du streaming en arrière-plan : ne bloque pas la réponse à l'utilisateur.
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
