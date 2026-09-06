import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AuthError, login, signAuthToken, signup } from "../services/auth.service";
import { authMiddleware, SESSION_COOKIE } from "../middlewares/auth.middleware";
import { sendLoginNotificationEmail, sendWelcomeEmail } from "../services/email.service";

export const authRouter = Router();

const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: SESSION_COOKIE_MAX_AGE,
};

function toPublicUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  accountType: string;
  organizationName: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    accountType: user.accountType,
    organizationName: user.organizationName,
    createdAt: user.createdAt,
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

    res.status(201).json({ user: toPublicUser(user) });
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

    res.json({ user: toPublicUser(user) });
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

authRouter.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    if (!user) {
      return res.status(401).json({ error: "Authentification requise." });
    }

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error("Erreur lors de la récupération de l'utilisateur courant :", err);
    res.status(500).json({ error: "Impossible de récupérer l'utilisateur courant." });
  }
});
