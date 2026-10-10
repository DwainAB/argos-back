import Stripe from "stripe";
import { prisma } from "../../lib/prisma";
import { SOLO_PROJECT_LIMIT, createPlanChangePortalSession, scheduleDowngradeAtPeriodEnd } from "./subscription.service";
import { startLogStreamForAnyProvider, stopLogStreamForProject } from "./log-stream-control.service";

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

  const organization = await prisma.$transaction(
    async (tx) => {
      const organization = await tx.organization.create({ data: { name: organizationName } });

      await tx.organizationMembership.create({
        data: { organizationId: organization.id, userId, role: "admin" },
      });

      await tx.project.updateMany({
        where: { userId },
        data: { organizationId: organization.id, archivedAt: null },
      });

      await tx.projectShare.deleteMany({ where: { project: { userId } } });

      await tx.user.update({ where: { id: userId }, data: { accountType: "organization", organizationName } });

      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { userId: null, organizationId: organization.id, plan: "business" },
      });

      return organization;
    },
    { timeout: 30_000 },
  );

  for (const project of archivedProjectIds) {
    const full = await prisma.project.findUnique({
      where: { id: project.id },
      include: { renderApiKeyRef: true },
    });
    if (full) startLogStreamForAnyProvider(full);
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
  const projectsToDelete = activeProjects.filter((p) => !keepSet.has(p.id));

  // Arrêté avant suppression : un log reçu pendant la transaction ne doit jamais tenter
  // d'écrire un LogEntry référençant un projet déjà effacé.
  for (const project of projectsToDelete) {
    stopLogStreamForProject(project.id);
  }

  await prisma.$transaction(
    async (tx) => {
      // Suppression définitive (pas d'archivage) des projets non conservés — emporte en
      // cascade tout leur historique (LogEntry, Alert, CodeAnalysis, ProjectShare), pour ne pas
      // laisser s'accumuler en base des projets inactifs sans limite de durée. Irréversible :
      // un réabonnement Business ultérieur ne les restaure pas.
      for (const project of projectsToDelete) {
        await tx.project.delete({ where: { id: project.id } });
      }

      await tx.projectShare.deleteMany({ where: { project: { organizationId } } });

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
    },
    // Timeout par défaut (5s) trop court dès que plusieurs projets sont supprimés en cascade
    // sur une base distante (latence réseau observée jusqu'à plusieurs secondes par requête
    // sur l'instance Railway) — valeur plus généreuse pour ne jamais interrompre la transaction
    // en plein milieu (ce qui laisserait l'organisation dans un état incohérent).
    { timeout: 30_000 },
  );
}

// Diffère le downgrade à la fin de la période de facturation en cours, sans proration (voir
// scheduleDowngradeAtPeriodEnd) — à la différence de l'upgrade, immédiat et facturé au
// prorata, pas de redirection vers le Customer Portal : rien à confirmer/payer, le changement
// s'applique seul à la date retournée.
export async function downgradeToSoloPlan(input: { userId: string; keepProjectIds?: string[] }): Promise<{ effectiveAt: Date }> {
  const { userId, keepProjectIds } = input;

  const { subscription } = await assertCanDowngradeToSolo(userId, keepProjectIds);

  return scheduleDowngradeAtPeriodEnd(subscription.id, "solo", {
    keepProjectIds: JSON.stringify(keepProjectIds ?? []),
  });
}

// Appelée depuis le webhook Stripe (voir subscription.service.ts::syncPlanFromStripeSubscription)
// une fois le changement de Price confirmé par un paiement. Lève systématiquement en cas
// d'état incohérent plutôt que d'ignorer silencieusement : le webhook route répond alors 500 à
// Stripe, qui retente l'événement (jusqu'à ~3 jours) au lieu de considérer, à tort, le
// changement de plan comme appliqué.
export async function applyConfirmedPlanChange(
  subscriptionId: string,
  newPlan: "solo" | "business",
  metadata: Stripe.Metadata,
) {
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

  if (newPlan === "business") {
    if (!subscription.userId) {
      throw new Error(`Upgrade confirmé pour l'abonnement ${subscriptionId} mais aucun userId porteur.`);
    }
    const organizationName = metadata.organizationName?.trim();
    if (!organizationName) {
      throw new Error(`Upgrade confirmé pour l'abonnement ${subscriptionId} mais organizationName absent des metadata.`);
    }
    await applyUpgradeToBusiness(subscription.userId, subscriptionId, organizationName);
    return;
  }

  if (!subscription.organizationId) {
    throw new Error(`Downgrade confirmé pour l'abonnement ${subscriptionId} mais aucune organizationId porteuse.`);
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: { organizationId: subscription.organizationId, role: "admin" },
  });
  if (!membership) {
    throw new Error(
      `Downgrade confirmé pour l'abonnement ${subscriptionId} mais aucun admin trouvé pour l'organisation ${subscription.organizationId}.`,
    );
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
