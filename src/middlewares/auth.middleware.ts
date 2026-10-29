import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { prisma } from "../lib/prisma";

// Code renvoyé quand l'utilisateur est bien authentifié chez Clerk mais n'a pas encore de
// compte Argos AI (onboarding pas terminé) — le frontend redirige alors vers /onboarding.
export const ONBOARDING_REQUIRED = "ONBOARDING_REQUIRED";

// Vérifie seulement la session Clerk (token Bearer envoyé par le frontend, validé par
// clerkMiddleware dans app.ts), sans exiger de compte Argos AI : sert à l'onboarding.
export function clerkSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const { userId: clerkUserId } = getAuth(req);

  if (!clerkUserId) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  req.clerkUserId = clerkUserId;
  next();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const { userId: clerkUserId } = getAuth(req);

  if (!clerkUserId) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  try {
    const user = await prisma.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } });

    if (!user) {
      return res.status(403).json({ error: "Configuration du compte requise.", code: ONBOARDING_REQUIRED });
    }

    req.clerkUserId = clerkUserId;
    req.userId = user.id;
    next();
  } catch (err) {
    next(err);
  }
}
