import { prisma } from "../../lib/prisma";
import type { Prisma } from "@prisma/client";

// Slugs stables des actions tracées — jamais de texte libre côté appelant, pour garder le
// journal filtrable/traduisible indépendamment du contenu (voir schema.prisma, ActivityLog).
export const ACTIVITY_ACTIONS = {
  PROJECT_CREATED: "project.created",
  PROJECT_RENAMED: "project.renamed",
  PROJECT_DELETED: "project.deleted",
  ALERT_RESOLVED: "alert.resolved",
  ALERT_REOPENED: "alert.reopened",
  FIX_REQUESTED: "fix.requested",
  FIX_ACCEPTED: "fix.accepted",
  FIX_REJECTED: "fix.rejected",
  CODE_ANALYSIS_STARTED: "code_analysis.started",
  GITHUB_REPO_CONNECTED: "github.repo_connected",
  GITHUB_INSTALLATION_DISCONNECTED: "github.installation_disconnected",
  GITLAB_REPO_CONNECTED: "gitlab.repo_connected",
  GITLAB_CONNECTION_REMOVED: "gitlab.connection_removed",
} as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS];

export type LogActivityParams = {
  userId: string | null;
  action: ActivityAction;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

// Point d'entrée unique pour écrire dans le journal d'activité — jamais d'écriture directe sur
// prisma.activityLog ailleurs dans le code, pour que la forme reste cohérente partout. Ne
// propage jamais d'erreur : un échec d'écriture du journal ne doit jamais faire échouer
// l'action métier qu'il accompagne (même principe que les notifications email/SMS).
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        projectId: params.projectId ?? null,
        metadata: params.metadata,
      },
    });
  } catch (err) {
    console.error(`Erreur lors de l'écriture du journal d'activité (action ${params.action}) :`, err);
  }
}

export type ActivityActor = {
  userId: string;
  firstName: string;
  lastName: string;
};

// Dernière entrée du journal pour une entité + action donnée, avec l'identité de l'acteur
// déjà résolue — utilisé pour l'affichage "Résolu par X" côté frontend. Retourne null si
// l'action n'a jamais été journalisée pour cette entité (ex: donnée antérieure à l'introduction
// du journal) ou si l'acteur n'a pas pu être déterminé (userId null).
export async function getLastActor(entityType: string, entityId: string, action: ActivityAction): Promise<ActivityActor | null> {
  const entry = await prisma.activityLog.findFirst({
    where: { entityType, entityId, action },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  if (!entry?.user) return null;

  return { userId: entry.user.id, firstName: entry.user.firstName, lastName: entry.user.lastName };
}

// Équivalent batch de getLastActor pour une liste d'entités (ex: toutes les alertes d'une
// page) — une seule requête plutôt qu'un aller-retour par entité, pour éviter le N+1 sur une
// liste. Retourne une Map entityId -> acteur, absente des entités jamais journalisées.
export async function getLastActors(
  entityType: string,
  entityIds: string[],
  action: ActivityAction
): Promise<Map<string, ActivityActor>> {
  if (entityIds.length === 0) return new Map();

  const entries = await prisma.activityLog.findMany({
    where: { entityType, entityId: { in: entityIds }, action },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  const result = new Map<string, ActivityActor>();
  for (const entry of entries) {
    // Le tri desc + "ne jamais écraser" garantit qu'on garde la plus récente par entité, même
    // si une entité a plusieurs entrées pour cette action (ex: résolue puis rouverte puis
    // re-résolue) — la première rencontrée dans l'ordre desc est la plus récente.
    if (!entry.user || result.has(entry.entityId)) continue;
    result.set(entry.entityId, { userId: entry.user.id, firstName: entry.user.firstName, lastName: entry.user.lastName });
  }

  return result;
}
