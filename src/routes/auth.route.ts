import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AuthError, login, signAuthToken, signup } from "../services/auth.service";
import { authMiddleware, SESSION_COOKIE } from "../middlewares/auth.middleware";

export const authRouter = Router();

// Durée de vie du cookie de session, alignée sur celle du JWT signé (voir auth.service.ts).
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: SESSION_COOKIE_MAX_AGE,
};

// Champs de l'utilisateur renvoyés au client : jamais passwordHash.
function toPublicUser(user: { id: string; email: string; firstName: string; lastName: string; phone: string | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/signup
// Crée un compte (email + mot de passe + prénom/nom) et ouvre directement la session.
authRouter.post("/api/auth/signup", async (req, res) => {
  try {
    const user = await signup(req.body ?? {});
    const token = signAuthToken(user.id);
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de l'inscription :", err);
    res.status(500).json({ error: "Impossible de créer le compte." });
  }
});

// POST /api/auth/login
// Vérifie les identifiants et ouvre une session.
authRouter.post("/api/auth/login", async (req, res) => {
  try {
    const user = await login(req.body ?? {});
    const token = signAuthToken(user.id);
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la connexion :", err);
    res.status(500).json({ error: "Impossible de vous connecter." });
  }
});

// POST /api/auth/logout
// Ferme la session en cours en supprimant le cookie.
authRouter.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
  res.status(204).end();
});

// GET /api/auth/me
// Renvoie l'utilisateur actuellement connecté. 401 si aucune session valide — c'est ce
// code que le frontend utilise pour distinguer "non connecté" d'une erreur réseau.
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
