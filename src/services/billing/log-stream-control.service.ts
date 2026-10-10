import { prisma } from "../../lib/prisma";
import { decryptSecret } from "../../lib/encryption";
import {
  stopLogStreamForProject as stopRailwayLogStreamForProject,
  startLogStreamForProject as startRailwayLogStreamForProject,
} from "../providers/railway/railway-log-stream.service";
import {
  stopLogStreamForProject as stopRenderLogStreamForProject,
  startLogStreamForProject as startRenderLogStreamForProject,
} from "../providers/render/render-log-stream.service";

type StreamableProject = {
  id: string;
  railwayProjectToken: string | null;
  railwayServiceId: string | null;
  railwayEnvironmentId: string | null;
  renderApiKeyRef: { encryptedKey: string } | null;
  renderOwnerId: string | null;
  renderResourceId: string | null;
};

// Reprend/arrête le streaming de logs d'un projet quel que soit son fournisseur d'hébergement
// (Railway, Render, ...) — un projet n'a jamais qu'un seul fournisseur connecté à la fois.
export function stopLogStreamForProject(projectId: string) {
  stopRailwayLogStreamForProject(projectId);
  stopRenderLogStreamForProject(projectId);
}

export function startLogStreamForAnyProvider(project: StreamableProject) {
  if (project.railwayProjectToken && project.railwayServiceId && project.railwayEnvironmentId) {
    startRailwayLogStreamForProject({
      id: project.id,
      railwayProjectToken: project.railwayProjectToken,
      railwayServiceId: project.railwayServiceId,
      railwayEnvironmentId: project.railwayEnvironmentId,
    }).catch((err) => console.error(`Échec de la reprise du streaming pour le projet ${project.id} :`, err));
  } else if (project.renderApiKeyRef && project.renderOwnerId && project.renderResourceId) {
    startRenderLogStreamForProject({
      id: project.id,
      renderApiKey: decryptSecret(project.renderApiKeyRef.encryptedKey),
      renderOwnerId: project.renderOwnerId,
      renderResourceId: project.renderResourceId,
    }).catch((err) => console.error(`Échec de la reprise du streaming pour le projet ${project.id} :`, err));
  }
}

// userId/organizationId à undefined dans un filtre Prisma signifie "ignorer ce filtre", pas
// "aucune correspondance" — un abonnement sans l'un ni l'autre (normalement jamais le cas en
// usage normal, mais pas interdit par le schéma) ne doit jamais tomber sur un findMany() sans
// condition, qui renverrait alors TOUS les projets de la base.
function projectsFilterForSubscription(subscription: { userId: string | null; organizationId: string | null }) {
  if (subscription.organizationId) return { organizationId: subscription.organizationId };
  if (subscription.userId) return { userId: subscription.userId };
  return null;
}

export async function stopAllLogStreamsForSubscription(subscription: { userId: string | null; organizationId: string | null }) {
  const filter = projectsFilterForSubscription(subscription);
  if (!filter) return;

  const projects = await prisma.project.findMany({ where: filter, select: { id: true } });

  for (const project of projects) {
    stopLogStreamForProject(project.id);
  }
}

export async function startAllLogStreamsForSubscription(subscription: { userId: string | null; organizationId: string | null }) {
  const filter = projectsFilterForSubscription(subscription);
  if (!filter) return;

  const projects = await prisma.project.findMany({
    where: { ...filter, archivedAt: null },
    include: { renderApiKeyRef: true },
  });

  for (const project of projects) {
    startLogStreamForAnyProvider(project);
  }
}
