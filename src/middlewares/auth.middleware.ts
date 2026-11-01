import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { prisma } from "../lib/prisma";
import { linkExistingAccount } from "../services/auth/auth.service";

// Connecté chez Clerk mais sans compte Argos AI : le frontend redirige vers /onboarding.
export const ONBOARDING_REQUIRED = "ONBOARDING_REQUIRED";

// Garde « allégé » : exige d'être connecté chez Clerk, sans compte Argos AI (sert à l'onboarding).
export function clerkSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  // Identifiant Clerk, lu dans le token déjà vérifié par clerkMiddleware (app.ts).
  const { userId: clerkUserId } = getAuth(req);

  // Pas connecté : 401.
  if (!clerkUserId) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  req.clerkUserId = clerkUserId;
  next();
}

// Email principal du compte Clerk, seulement s'il est vérifié (sinon n'importe qui pourrait saisir ton email).
async function findVerifiedPrimaryEmail(clerkUserId: string) {
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const primaryEmail = clerkUser.primaryEmailAddress;
  return primaryEmail?.verification?.status === "verified" ? primaryEmail.emailAddress : null;
}

// Garde principal (placé dans app.ts) : exige d'être connecté ET d'avoir un compte Argos AI.
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const { userId: clerkUserId } = getAuth(req);

  // Pas connecté chez Clerk : 401.
  if (!clerkUserId) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  try {
    // Cas normal : compte Argos AI déjà relié à ce compte Clerk.
    let user = await prisma.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } });

    // Sinon : compte créé avant Clerk ? On le relie par email vérifié (une seule fois).
    if (!user) {
      const verifiedEmail = await findVerifiedPrimaryEmail(clerkUserId);
      user = verifiedEmail ? await linkExistingAccount(clerkUserId, verifiedEmail) : null;
    }

    // Toujours rien : connecté mais onboarding pas fait → 403.
    if (!user) {
      return res.status(403).json({ error: "Configuration du compte requise.", code: ONBOARDING_REQUIRED });
    }

    // Accès autorisé : req.userId sert ensuite à toutes les routes pour retrouver ses données.
    req.clerkUserId = clerkUserId;
    req.userId = user.id;
    next();
  } catch (err) {
    // Base ou Clerk indisponible : transmet l'erreur à Express (réponse 500).
    next(err);
  }
}
