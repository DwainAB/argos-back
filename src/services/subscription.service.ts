import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { sendUsageLimitReachedEmail, sendUsageLimitWarningEmail } from "./email.service";

const stripe = env.stripe.secretKey ? new Stripe(env.stripe.secretKey) : null;

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

// Essai gratuit uniquement sur Solo, carte bancaire requise dès l'inscription (voir
// CAHIER_DES_CHARGES.md section 6.1) — Business n'a pas d'essai.
const SOLO_TRIAL_DAYS = 14;

export const QUOTAS = {
  solo: { sms: 10, fixes: 5 },
  business: { sms: 60, fixes: 30 },
} as const;

const USAGE_WARNING_THRESHOLD = 0.8;

function requireStripe(): Stripe {
  if (!stripe) {
    throw new SubscriptionError("Stripe n'est pas configuré (STRIPE_SECRET_KEY manquant).", 500);
  }
  return stripe;
}

// Depuis l'API "flexible billing" de Stripe, la fin de période courante n'est plus portée
// par la Subscription elle-même mais par chacune de ses lignes (SubscriptionItem) — on
// prend celle du premier item, le seul dans notre cas (un abonnement = un seul Price).
function currentPeriodEndOf(stripeSubscription: Stripe.Subscription): Date | null {
  const periodEnd = stripeSubscription.items.data[0]?.current_period_end;
  return periodEnd ? new Date(periodEnd * 1000) : null;
}

// De même, l'abonnement à l'origine d'une facture est référencé via invoice.parent plutôt
// que directement sur invoice.subscription.
function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  return typeof subscription === "string" ? subscription : (subscription?.id ?? null);
}

function priceIdForPlan(plan: "solo" | "business"): string {
  const priceId = plan === "solo" ? env.stripe.priceSolo : env.stripe.priceBusiness;
  if (!priceId) {
    throw new SubscriptionError(`Aucun Price Stripe configuré pour le plan ${plan}.`, 500);
  }
  return priceId;
}

// Crée le client Stripe et l'abonnement local (statut "incomplete" tant que le paiement
// n'est pas confirmé côté Stripe) — appelé depuis auth.service.ts::signup, dans la même
// transaction que la création du compte/de l'organisation.
export async function createPendingSubscription(input: {
  ownerType: "user" | "organization";
  ownerId: string;
  email: string;
  plan: "solo" | "business";
}) {
  const client = requireStripe();
  const { ownerType, ownerId, email, plan } = input;

  const customer = await client.customers.create({ email });

  return prisma.subscription.create({
    data: {
      userId: ownerType === "user" ? ownerId : undefined,
      organizationId: ownerType === "organization" ? ownerId : undefined,
      plan,
      status: "incomplete",
      stripeCustomerId: customer.id,
    },
  });
}

// Crée la session Stripe Checkout vers laquelle rediriger l'utilisateur après l'inscription
// (ou depuis la page facturation, s'il avait abandonné le paiement initial).
export async function createCheckoutSession(subscriptionId: string) {
  const client = requireStripe();

  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: subscription.stripeCustomerId,
    line_items: [{ price: priceIdForPlan(subscription.plan as "solo" | "business"), quantity: 1 }],
    subscription_data:
      subscription.plan === "solo" ? { trial_period_days: SOLO_TRIAL_DAYS } : undefined,
    success_url: `${env.frontendUrl}/dashboard?checkout=success`,
    cancel_url: `${env.frontendUrl}/dashboard/organizations/billing?checkout=cancelled`,
  });

  if (!session.url) {
    throw new SubscriptionError("Impossible de créer la session de paiement.", 502);
  }

  return session.url;
}

// Crée l'URL du Customer Portal Stripe (gestion de moyen de paiement, factures, résiliation).
export async function createBillingPortalSession(subscriptionId: string) {
  const client = requireStripe();

  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

  const session = await client.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.frontendUrl}/dashboard/organizations/billing`,
  });

  return session.url;
}

export async function getSubscriptionForUser(userId: string) {
  return prisma.subscription.findUnique({ where: { userId } });
}

export async function getSubscriptionForOrganization(organizationId: string) {
  return prisma.subscription.findUnique({ where: { organizationId } });
}

// L'abonnement dont dépend un utilisateur donné : le sien propre s'il est un compte
// personnel non membre d'une organisation, ou celui, partagé, de l'organisation dont il
// est membre (Solo et Business ne se combinent jamais pour un même utilisateur).
export async function getSubscriptionForRequestingUser(userId: string) {
  const membership = await prisma.organizationMembership.findUnique({ where: { userId } });

  if (membership) {
    return getSubscriptionForOrganization(membership.organizationId);
  }

  return getSubscriptionForUser(userId);
}

// L'abonnement dont dépend un projet : celui de son organisation propriétaire s'il en a
// une, sinon celui du compte personnel qui l'a créé.
export async function getSubscriptionForProject(project: { userId: string; organizationId: string | null }) {
  if (project.organizationId) {
    return getSubscriptionForOrganization(project.organizationId);
  }

  return getSubscriptionForUser(project.userId);
}

// Un abonnement donne accès au produit s'il est en cours d'essai ou payé à jour — jamais
// pour "incomplete" (paiement jamais finalisé), "past_due" (échec de prélèvement) ou
// "canceled".
export function hasActiveAccess(subscription: { status: string } | null): boolean {
  return subscription?.status === "trialing" || subscription?.status === "active";
}

async function warnOrBlockUsage(params: {
  subscriptionId: string;
  kind: "sms" | "fixes";
  used: number;
  limit: number;
  warningsSent: number;
  notify: (thresholdReached: "warning" | "limit") => Promise<void>;
}) {
  const { subscriptionId, kind, used, limit, warningsSent, notify } = params;

  if (used >= limit) {
    if (warningsSent < 2) {
      await notify("limit");
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { [`${kind}LimitWarningsSentThisPeriod`]: 2 },
      });
    }
    return false;
  }

  if (used / limit >= USAGE_WARNING_THRESHOLD && warningsSent < 1) {
    await notify("warning");
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { [`${kind}LimitWarningsSentThisPeriod`]: 1 },
    });
  }

  return true;
}

// À appeler AVANT d'envoyer un SMS d'alerte : renvoie false si le quota du mois est déjà
// atteint (le SMS ne doit alors pas partir — l'email d'alerte, lui, continue toujours).
// Incrémente le compteur si l'envoi est autorisé.
export async function tryConsumeSmsQuota(subscription: {
  id: string;
  plan: string;
  smsUsedThisPeriod: number;
  smsLimitWarningsSentThisPeriod: number;
}, recipientEmail: string): Promise<boolean> {
  const limit = QUOTAS[subscription.plan as "solo" | "business"]?.sms ?? QUOTAS.solo.sms;

  const allowed = await warnOrBlockUsage({
    subscriptionId: subscription.id,
    kind: "sms",
    used: subscription.smsUsedThisPeriod,
    limit,
    warningsSent: subscription.smsLimitWarningsSentThisPeriod,
    notify: (threshold) =>
      threshold === "limit"
        ? sendUsageLimitReachedEmail({ to: recipientEmail, resource: "SMS", limit })
        : sendUsageLimitWarningEmail({ to: recipientEmail, resource: "SMS", used: subscription.smsUsedThisPeriod, limit }),
  });

  if (!allowed) return false;

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { smsUsedThisPeriod: { increment: 1 } },
  });

  return true;
}

// Équivalent pour les corrections proposées par l'IA distante.
export async function tryConsumeFixQuota(subscription: {
  id: string;
  plan: string;
  fixesUsedThisPeriod: number;
  fixesLimitWarningsSentThisPeriod: number;
}, recipientEmail: string): Promise<boolean> {
  const limit = QUOTAS[subscription.plan as "solo" | "business"]?.fixes ?? QUOTAS.solo.fixes;

  const allowed = await warnOrBlockUsage({
    subscriptionId: subscription.id,
    kind: "fixes",
    used: subscription.fixesUsedThisPeriod,
    limit,
    warningsSent: subscription.fixesLimitWarningsSentThisPeriod,
    notify: (threshold) =>
      threshold === "limit"
        ? sendUsageLimitReachedEmail({ to: recipientEmail, resource: "correction IA", limit })
        : sendUsageLimitWarningEmail({ to: recipientEmail, resource: "correction IA", used: subscription.fixesUsedThisPeriod, limit }),
  });

  if (!allowed) return false;

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { fixesUsedThisPeriod: { increment: 1 } },
  });

  return true;
}

// Traite les événements du webhook Stripe. Volontairement permissif sur les types
// d'événements non gérés (les ignore) — Stripe peut envoyer bien plus d'événements que
// ceux qui nous intéressent.
export async function handleStripeWebhookEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (typeof session.subscription !== "string" || typeof session.customer !== "string") return;

      const subscription = await prisma.subscription.findUnique({ where: { stripeCustomerId: session.customer } });
      if (!subscription) return;

      const client = requireStripe();
      const stripeSubscription = await client.subscriptions.retrieve(session.subscription);

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          currentPeriodEnd: currentPeriodEndOf(stripeSubscription),
        },
      });
      return;
    }

    case "customer.subscription.updated": {
      const stripeSubscription = event.data.object as Stripe.Subscription;
      const subscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: stripeSubscription.id },
      });
      if (!subscription) return;

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: stripeSubscription.status,
          currentPeriodEnd: currentPeriodEndOf(stripeSubscription),
        },
      });
      return;
    }

    case "customer.subscription.deleted": {
      const stripeSubscription = event.data.object as Stripe.Subscription;
      const subscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: stripeSubscription.id },
      });
      if (!subscription) return;

      await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "canceled" } });
      return;
    }

    // Renouvellement de période : remet les compteurs d'usage et les avertissements à zéro.
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeSubscriptionId = subscriptionIdOfInvoice(invoice);
      if (!stripeSubscriptionId) return;

      const subscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId },
      });
      if (!subscription) return;

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "active",
          smsUsedThisPeriod: 0,
          fixesUsedThisPeriod: 0,
          smsLimitWarningsSentThisPeriod: 0,
          fixesLimitWarningsSentThisPeriod: 0,
        },
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeSubscriptionId = subscriptionIdOfInvoice(invoice);
      if (!stripeSubscriptionId) return;

      const subscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId },
      });
      if (!subscription) return;

      await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "past_due" } });
      return;
    }

    default:
      return;
  }
}
