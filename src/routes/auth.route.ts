import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { prisma } from "../lib/prisma";
import { AuthError, completeOnboarding, updatePhone } from "../services/auth/auth.service";
import { authMiddleware, clerkSessionMiddleware } from "../middlewares/auth.middleware";
import { sendWelcomeEmail } from "../services/notifications/email.service";
import { hasActiveAccess } from "../services/billing/subscription.service";
import { env } from "../config/env";
import { logger } from "../lib/logger";

export const authRouter = Router();

// L'abonnement d'un compte est le sien propre (compte personnel non membre d'une
// organisation) ou celui, partagé, de l'organisation dont il est membre.
async function findSubscription(user: {
  id: string;
  membership?: { organizationId: string } | null;
}): Promise<{ status: string; blockedAt: Date | null; lastPaymentFailedAt: Date | null } | null> {
  const subscription = user.membership
    ? await prisma.subscription.findUnique({ where: { organizationId: user.membership.organizationId } })
    : await prisma.subscription.findUnique({ where: { userId: user.id } });

  return subscription
    ? { status: subscription.status, blockedAt: subscription.blockedAt, lastPaymentFailedAt: subscription.lastPaymentFailedAt }
    : null;
}

async function toPublicUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  accountType: string;
  organizationName: string | null;
  createdAt: Date;
  membership?: { role: string; organizationId: string } | null;
}) {
  const subscription = await findSubscription(user);

  // Même logique que /api/subscription/me (voir subscription.route.ts) : la date limite
  // n'a de sens que pendant le délai de grâce lui-même (échec en cours, pas déjà bloqué).
  const paymentGraceDeadline =
    subscription?.lastPaymentFailedAt && !subscription.blockedAt
      ? new Date(subscription.lastPaymentFailedAt.getTime() + env.billing.paymentGracePeriodDays * 24 * 60 * 60 * 1000)
      : null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    accountType: user.accountType,
    organizationName: user.organizationName,
    createdAt: user.createdAt,
    organizationRole: user.membership?.role ?? null,
    subscriptionStatus: subscription?.status ?? null,
    hasActiveSubscription: hasActiveAccess(subscription),
    subscriptionBlocked: !!subscription?.blockedAt,
    paymentGraceDeadline,
  };
}

// Inscription, connexion, mot de passe oublié et comptes liés (Google, GitHub, GitLab) sont
// entièrement gérés par Clerk : il ne reste ici que la création du compte Argos AI lui-même
// (type de compte, organisation), au premier passage après l'inscription chez Clerk.
authRouter.post("/api/auth/onboarding", clerkSessionMiddleware, async (req, res) => {
  try {
    const clerkUser = await clerkClient.users.getUser(req.clerkUserId as string);
    const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress;

    if (!primaryEmail) {
      return res.status(400).json({ error: "Aucune adresse email principale n'est associée à ce compte." });
    }

    const user = await completeOnboarding({ clerkId: clerkUser.id, email: primaryEmail }, req.body ?? {});

    sendWelcomeEmail({ to: user.email, firstName: user.firstName }).catch((err) =>
      logger.error({ err }, `Erreur lors de l'envoi de l'email de bienvenue à ${user.email} :`)
    );

    res.status(201).json({ user: await toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    logger.error({ err }, "Erreur lors de la configuration du compte :");
    res.status(500).json({ error: "Impossible de créer le compte." });
  }
});

authRouter.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { membership: true } });

    if (!user) {
      return res.status(401).json({ error: "Authentification requise." });
    }

    res.json({ user: await toPublicUser(user) });
  } catch (err) {
    logger.error({ err }, "Erreur lors de la récupération de l'utilisateur courant :");
    res.status(500).json({ error: "Impossible de récupérer l'utilisateur courant." });
  }
});

authRouter.patch("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await updatePhone(req.userId as string, req.body?.phone);
    res.json({ user: await toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    logger.error({ err }, "Erreur lors de la mise à jour du numéro de téléphone :");
    res.status(500).json({ error: "Impossible de mettre à jour le numéro de téléphone." });
  }
});
