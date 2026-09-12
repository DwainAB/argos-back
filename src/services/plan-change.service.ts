import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { SOLO_PROJECT_LIMIT, createPlanChangePortalSession } from "./subscription.service";
import { stopLogStreamForProject, startLogStreamForProject } from "./railway-log-stream.service";

export class PlanChangeError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export async function getDowngradePreview(organizationId: string) {
  const [memberCount, activeProjects] = await Promise.all([
    prisma.organizationMembership.count({ where: { organizationId } }),
    prisma.project.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    memberCount,
    activeProjects,
    blockedByMembers: memberCount > 1,
    requiresProjectSelection: activeProjects.length > SOLO_PROJECT_LIMIT,
  };
}

async function assertCanUpgradeToBusiness(userId: string) {
  const [existingMembership, subscription] = await Promise.all([
    prisma.organizationMembership.findUnique({ where: { userId } }),
    prisma.subscription.findUnique({ where: { userId } }),
  ]);

  if (existingMembership) {
    throw new PlanChangeError("Vous êtes déjà membre d'une organisation.", 422);
  }

  if (!subscription) {
    throw new PlanChangeError("Aucun abonnement Solo actif à faire évoluer.", 404);
  }

  if (!subscription.stripeSubscriptionId) {
    throw new PlanChangeError("Votre abonnement n'est pas encore actif — finalisez d'abord votre paiement.", 422);
  }

  return subscription;
}

async function applyUpgradeToBusiness(userId: string, subscriptionId: string, organizationName: string) {
  const archivedProjectIds = await prisma.project.findMany({
    where: { userId, archivedAt: { not: null } },
    select: { id: true },
  });

  const organization = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: organizationName } });

    await tx.organizationMembership.create({
      data: { organizationId: organization.id, userId, role: "admin" },
    });

    await tx.project.updateMany({
      where: { userId },
      data: { organizationId: organization.id, archivedAt: null },
    });

    await tx.user.update({ where: { id: userId }, data: { accountType: "organization", organizationName } });

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: { userId: null, organizationId: organization.id, plan: "business" },
    });

    return organization;
  });

  for (const project of archivedProjectIds) {
    const full = await prisma.project.findUnique({ where: { id: project.id } });
    if (full?.railwayProjectToken && full.railwayServiceId && full.railwayEnvironmentId) {
      startLogStreamForProject({
        id: full.id,
        railwayProjectToken: full.railwayProjectToken,
        railwayServiceId: full.railwayServiceId,
        railwayEnvironmentId: full.railwayEnvironmentId,
      }).catch((err) => console.error(`Échec de la reprise du streaming pour le projet ${full.id} :`, err));
    }
  }

  return organization;
}

export async function upgradeToBusinessPlan(input: { userId: string; organizationName: unknown; returnUrl: string }): Promise<string> {
  const { userId, organizationName, returnUrl } = input;

  if (typeof organizationName !== "string" || !organizationName.trim()) {
    throw new PlanChangeError("Le nom de l'organisation est requis.", 400);
  }
  const trimmedName = organizationName.trim();

  const subscription = await assertCanUpgradeToBusiness(userId);

  return createPlanChangePortalSession(subscription.id, returnUrl, { organizationName: trimmedName });
}

async function assertCanDowngradeToSolo(userId: string, keepProjectIds: string[] | undefined) {
  const membership = await prisma.organizationMembership.findUnique({ where: { userId } });
  if (!membership) {
    throw new PlanChangeError("Vous n'appartenez à aucune organisation.", 422);
  }

  if (membership.role !== "admin") {
    throw new PlanChangeError("Seul un administrateur de l'organisation peut changer de plan.", 403);
  }

  const preview = await getDowngradePreview(membership.organizationId);

  if (preview.blockedByMembers) {
    throw new PlanChangeError("Retirez les autres membres de l'organisation avant de repasser au plan Solo.", 422);
  }

  if (preview.requiresProjectSelection) {
    const keepSet = new Set(keepProjectIds ?? []);
    const validKeepIds = preview.activeProjects.filter((p) => keepSet.has(p.id)).map((p) => p.id);

    if (validKeepIds.length !== keepSet.size || keepSet.size > SOLO_PROJECT_LIMIT || keepSet.size === 0) {
      throw new PlanChangeError(
        `Sélectionnez entre 1 et ${SOLO_PROJECT_LIMIT} projets à garder actifs parmi ceux de l'organisation.`,
        400,
      );
    }
  }

  const subscription = await prisma.subscription.findUnique({ where: { organizationId: membership.organizationId } });
  if (!subscription) {
    throw new PlanChangeError("Aucun abonnement Business actif à faire évoluer.", 404);
  }

  if (!subscription.stripeSubscriptionId) {
    throw new PlanChangeError("Votre abonnement n'est pas encore actif — finalisez d'abord votre paiement.", 422);
  }

  return { organizationId: membership.organizationId, subscription };
}

async function applyDowngradeToSolo(input: { userId: string; organizationId: string; subscriptionId: string; keepProjectIds: string[] }) {
  const { userId, organizationId, subscriptionId, keepProjectIds } = input;

  const activeProjects = await prisma.project.findMany({
    where: { organizationId, archivedAt: null },
    select: { id: true },
  });
  const keepSet = new Set(keepProjectIds);
  const projectsToArchive = activeProjects.filter((p) => !keepSet.has(p.id));

  await prisma.$transaction(async (tx) => {
    for (const project of projectsToArchive) {
      await tx.project.update({ where: { id: project.id }, data: { archivedAt: new Date() } });
    }

    await tx.project.updateMany({
      where: { organizationId },
      data: { organizationId: null },
    });

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: { organizationId: null, userId, plan: "solo" },
    });

    await tx.organizationMembership.delete({ where: { userId } });
    await tx.organization.delete({ where: { id: organizationId } });

    await tx.user.update({ where: { id: userId }, data: { accountType: "personal", organizationName: null } });
  });

  for (const project of projectsToArchive) {
    stopLogStreamForProject(project.id);
  }
}

export async function downgradeToSoloPlan(input: { userId: string; keepProjectIds?: string[]; returnUrl: string }): Promise<string> {
  const { userId, keepProjectIds, returnUrl } = input;

  const { subscription } = await assertCanDowngradeToSolo(userId, keepProjectIds);

  return createPlanChangePortalSession(subscription.id, returnUrl, {
    keepProjectIds: JSON.stringify(keepProjectIds ?? []),
  });
}

export async function applyConfirmedPlanChange(
  subscriptionId: string,
  newPlan: "solo" | "business",
  metadata: Stripe.Metadata,
) {
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

  if (newPlan === "business") {
    if (!subscription.userId) {
      console.error(`Upgrade confirmé pour l'abonnement ${subscriptionId} mais aucun userId porteur — ignoré.`);
      return;
    }
    const organizationName = metadata.organizationName?.trim();
    if (!organizationName) {
      console.error(`Upgrade confirmé pour l'abonnement ${subscriptionId} mais organizationName absent des metadata — ignoré.`);
      return;
    }
    await applyUpgradeToBusiness(subscription.userId, subscriptionId, organizationName);
    return;
  }

  if (!subscription.organizationId) {
    console.error(`Downgrade confirmé pour l'abonnement ${subscriptionId} mais aucune organizationId porteuse — ignoré.`);
    return;
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: { organizationId: subscription.organizationId, role: "admin" },
  });
  if (!membership) {
    console.error(`Downgrade confirmé pour l'abonnement ${subscriptionId} mais aucun admin trouvé pour l'organisation ${subscription.organizationId} — ignoré.`);
    return;
  }
  let keepProjectIds: string[] = [];
  try {
    keepProjectIds = metadata.keepProjectIds ? JSON.parse(metadata.keepProjectIds) : [];
  } catch {
    keepProjectIds = [];
  }

  await applyDowngradeToSolo({
    userId: membership.userId,
    organizationId: subscription.organizationId,
    subscriptionId,
    keepProjectIds,
  });
}
