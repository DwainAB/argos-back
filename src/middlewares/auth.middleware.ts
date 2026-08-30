import type { NextFunction, Request, Response } from "express";
import { verifyAuthToken } from "../services/auth.service";

// Nom du cookie de session posé par POST /api/auth/login et /api/auth/signup.
export const SESSION_COOKIE = "argos_session";

// Vérifie le cookie de session sur les routes protégées et attache req.userId. Renvoie
// 401 si le cookie est absent ou invalide, sans jamais laisser passer la requête.
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const userId = token ? verifyAuthToken(token) : null;

  if (!userId) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  req.userId = userId;
  next();
}
