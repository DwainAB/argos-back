import type { NextFunction, Request, Response } from "express";
import { verifyAuthToken } from "../services/auth.service";

export const SESSION_COOKIE = "argos_session";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const userId = token ? verifyAuthToken(token) : null;

  if (!userId) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  req.userId = userId;
  next();
}
