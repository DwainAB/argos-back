import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  AuthError,
  changePassword,
  login,
  requestPasswordReset,
  resetPassword,
  signAuthToken,
  signup,
  updatePhone,
} from "../services/auth.service";
import { authMiddleware, SESSION_COOKIE } from "../middlewares/auth.middleware";
import {
  sendLoginNotificationEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../services/email.service";
import { hasActiveAccess } from "../services/subscription.service";
import { env } from "../config/env";

export const authRouter = Router();

const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: SESSION_COOKIE_MAX_AGE,
};

// L'abonnement d'un compte est le sien propre (compte personnel non membre d'une
// organisation) ou celui, partagé, de l'organisation dont il est membre.
async function findSubscriptionStatus(user: {
  id: string;
  membership?: { organizationId: string } | null;
}): Promise<string | null> {
  if (user.membership) {
    const subscription = await prisma.subscription.findUnique({ where: { organizationId: user.membership.organizationId } });
    return subscription?.status ?? null;
  }

  const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
  return subscription?.status ?? null;
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
  const subscriptionStatus = await findSubscriptionStatus(user);

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
    subscriptionStatus,
    hasActiveSubscription: hasActiveAccess(subscriptionStatus ? { status: subscriptionStatus } : null),
  };
}

authRouter.post("/api/auth/signup", async (req, res) => {
  try {
    const user = await signup(req.body ?? {});
    const token = signAuthToken(user.id);
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

    sendWelcomeEmail({ to: user.email, firstName: user.firstName }).catch((err) =>
      console.error(`Erreur lors de l'envoi de l'email de bienvenue à ${user.email} :`, err)
    );

    res.status(201).json({ user: await toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de l'inscription :", err);
    res.status(500).json({ error: "Impossible de créer le compte." });
  }
});

authRouter.post("/api/auth/login", async (req, res) => {
  try {
    const user = await login(req.body ?? {});
    const token = signAuthToken(user.id);
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

    sendLoginNotificationEmail({ to: user.email, firstName: user.firstName }).catch((err) =>
      console.error(`Erreur lors de l'envoi de l'email de notification de connexion à ${user.email} :`, err)
    );

    res.json({ user: await toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la connexion :", err);
    res.status(500).json({ error: "Impossible de vous connecter." });
  }
});

authRouter.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
  res.status(204).end();
});

authRouter.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const result = await requestPasswordReset(req.body?.email);

    if (result) {
      const resetUrl = `${env.frontendUrl}/reset-password?token=${result.token}`;
      sendPasswordResetEmail({ to: (req.body?.email as string).trim().toLowerCase(), firstName: result.user.firstName, resetUrl }).catch(
        (err) => console.error("Erreur lors de l'envoi de l'email de réinitialisation :", err)
      );
    }

    // Réponse identique que l'email corresponde à un compte ou non, pour ne pas permettre
    // de deviner quels emails sont inscrits (énumération de comptes).
    res.json({ message: "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé." });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la demande de réinitialisation de mot de passe :", err);
    res.status(500).json({ error: "Impossible de traiter cette demande." });
  }
});

authRouter.post("/api/auth/reset-password", async (req, res) => {
  try {
    const user = await resetPassword({ token: req.body?.token, newPassword: req.body?.newPassword });

    sendPasswordChangedEmail({ to: user.email, firstName: user.firstName }).catch((err) =>
      console.error(`Erreur lors de l'envoi de l'email de changement de mot de passe à ${user.email} :`, err)
    );

    res.json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la réinitialisation du mot de passe :", err);
    res.status(500).json({ error: "Impossible de réinitialiser le mot de passe." });
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
    console.error("Erreur lors de la récupération de l'utilisateur courant :", err);
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
    console.error("Erreur lors de la mise à jour du numéro de téléphone :", err);
    res.status(500).json({ error: "Impossible de mettre à jour le numéro de téléphone." });
  }
});

authRouter.patch("/api/auth/password", authMiddleware, async (req, res) => {
  try {
    const user = await changePassword(req.userId as string, {
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    });

    sendPasswordChangedEmail({ to: user.email, firstName: user.firstName }).catch((err) =>
      console.error(`Erreur lors de l'envoi de l'email de changement de mot de passe à ${user.email} :`, err)
    );

    res.json({ user: await toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors du changement de mot de passe :", err);
    res.status(500).json({ error: "Impossible de mettre à jour le mot de passe." });
  }
});
