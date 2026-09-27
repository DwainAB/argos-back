import { Router } from "express";
import { prisma } from "../lib/prisma";
import { fetchLatestDeploymentLogsWithProjectToken } from "../services/providers/railway/railway-project-token.service";
import { startLogStreamForProject as startRailwayLogStreamForProject } from "../services/providers/railway/railway-log-stream.service";
import { startLogStreamForProject as startRenderLogStreamForProject } from "../services/providers/render/render-log-stream.service";
import {
  createRenderApiKey,
  getDecryptedRenderApiKey,
  RenderApiKeyError,
} from "../services/providers/render/render-api-key.service";
import { getMembershipForUser } from "../services/organization/organization.service";
import { SOLO_PROJECT_LIMIT } from "../services/billing/subscription.service";
import { logActivity, ACTIVITY_ACTIONS } from "../services/activity/activity-log.service";

export const projectsRouter = Router();

type RailwayInput = { projectToken: string; serviceId: string; environmentId: string };
// Soit apiKeyId (une clé déjà stockée, réutilisée sans ressaisie), soit newApiKey (nouvelle
// clé, stockée chiffrée à cette occasion pour les prochains projets) — jamais les deux.
type RenderInput = { apiKeyId?: string; newApiKey?: string; newApiKeyLabel?: string; ownerId: string; resourceId: string };
type GithubInput = { installationId: number; repoFullName: string; branch: string };
type GitlabInput = { connectionId: string; gitlabProjectId: number; repoFullPath: string; branch: string };

// Point d'entrée unique de création de projet : le Project n'est écrit en base qu'ici, une
// fois que l'utilisateur a rassemblé toutes les informations voulues côté frontend (hébergeur
// + éventuellement GitHub) et clique sur le bouton final — jamais à l'ouverture d'une simple
// modale de connexion, pour ne pas laisser de projet fantôme (avec un streaming démarré pour
// rien) si l'utilisateur abandonne le formulaire en cours de route.
projectsRouter.post("/api/projects", async (req, res) => {
  const { projectName, railway, render, github, gitlab } = req.body ?? {} as {
    projectName?: string;
    railway?: RailwayInput;
    render?: RenderInput;
    github?: GithubInput;
    gitlab?: GitlabInput;
  };

  if (!railway && !render) {
    return res.status(400).json({ error: "Un hébergeur (Railway ou Render) est requis." });
  }
  if (railway && render) {
    return res.status(400).json({ error: "Un seul hébergeur à la fois est autorisé par projet." });
  }

  if (railway && (!railway.projectToken || !railway.serviceId || !railway.environmentId)) {
    return res.status(400).json({ error: "projectToken, serviceId et environmentId sont requis pour Railway." });
  }
  if (render) {
    if (!render.apiKeyId && !render.newApiKey) {
      return res.status(400).json({ error: "apiKeyId ou newApiKey est requis pour Render." });
    }
    if (!render.ownerId || !render.resourceId) {
      return res.status(400).json({ error: "ownerId et resourceId sont requis pour Render." });
    }
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
    if (railway) {
      // Vérifie que le token/les identifiants Railway sont valides avant de créer quoi que ce
      // soit — mieux vaut échouer ici que de créer un projet avec des identifiants invalides.
      await fetchLatestDeploymentLogsWithProjectToken(railway.projectToken, {
        serviceId: railway.serviceId,
        environmentId: railway.environmentId,
      });
    }

    let renderApiKeyId: string | null = null;
    let renderApiKeyPlain: string | null = null;

    if (render) {
      if (render.apiKeyId) {
        renderApiKeyId = render.apiKeyId;
        renderApiKeyPlain = await getDecryptedRenderApiKey(req.userId as string, render.apiKeyId);
      } else {
        const created = await createRenderApiKey(req.userId as string, {
          apiKey: render.newApiKey as string,
          label: render.newApiKeyLabel,
        });
        renderApiKeyId = created.id;
        renderApiKeyPlain = render.newApiKey as string;
      }
    }

    const project = await prisma.project.create({
      data: {
        name: projectName || (railway ? "Projet Railway sans nom" : "Projet Render sans nom"),
        userId: req.userId as string,
        organizationId: membership?.organizationId,
        ...(railway
          ? {
              railwayProjectToken: railway.projectToken,
              railwayServiceId: railway.serviceId,
              railwayEnvironmentId: railway.environmentId,
            }
          : {
              renderApiKeyId,
              renderOwnerId: render!.ownerId,
              renderResourceId: render!.resourceId,
            }),
        ...(github
          ? {
              githubInstallationId: Number(github.installationId),
              githubRepo: github.repoFullName,
              githubBranch: github.branch,
            }
          : {}),
        ...(gitlab
          ? {
              gitlabConnectionId: gitlab.connectionId,
              gitlabProjectId: Number(gitlab.gitlabProjectId),
              gitlabRepo: gitlab.repoFullPath,
              gitlabBranch: gitlab.branch,
            }
          : {}),
      },
    });

    if (railway) {
      startRailwayLogStreamForProject({
        id: project.id,
        railwayProjectToken: railway.projectToken,
        railwayServiceId: railway.serviceId,
        railwayEnvironmentId: railway.environmentId,
      }).catch((err) => console.error(`Échec du démarrage du streaming pour le projet ${project.id} :`, err));
    } else {
      startRenderLogStreamForProject({
        id: project.id,
        renderApiKey: renderApiKeyPlain as string,
        renderOwnerId: render!.ownerId,
        renderResourceId: render!.resourceId,
      }).catch((err) => console.error(`Échec du démarrage du streaming pour le projet ${project.id} :`, err));
    }

    await logActivity({
      userId: req.userId as string,
      action: ACTIVITY_ACTIONS.PROJECT_CREATED,
      entityType: "Project",
      entityId: project.id,
      projectId: project.id,
      metadata: { name: project.name, hostingProvider: railway ? "railway" : "render" },
    });

    res.json({ project });
  } catch (err) {
    if (err instanceof RenderApiKeyError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la création du projet :", err);
    res.status(502).json({
      error: railway
        ? "Impossible de récupérer les logs. Vérifiez le token, le Service ID et l'Environment ID."
        : "Impossible de connecter ce service. Vérifiez la clé API, l'Owner ID et le Resource ID.",
    });
  }
});
