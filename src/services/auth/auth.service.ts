import { prisma } from "../../lib/prisma";
import { createPendingSubscription } from "../billing/subscription.service";

// Format E.164 (ex: +33612345678), accepté par SMSFactor pour l'envoi de SMS.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

function assertNonEmpty(value: unknown, fieldLabel: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AuthError(`${fieldLabel} est requis.`, 400);
  }
}

function assertValidAccountType(accountType: unknown): asserts accountType is "personal" | "organization" {
  if (accountType !== "personal" && accountType !== "organization") {
    throw new AuthError("Type de compte invalide.", 400);
  }
}

function assertValidPhone(phone: unknown): asserts phone is string {
  if (typeof phone !== "string" || !PHONE_REGEX.test(phone)) {
    throw new AuthError("Numéro de téléphone invalide : utilisez le format international, ex. +33612345678.", 400);
  }
}

// Identité vérifiée par Clerk (id et email principal), récupérée via l'API Clerk à partir du
// token de session — jamais lue depuis le corps de la requête, contrairement au type de
// compte et aux prénom/nom (pré-remplis côté frontend, modifiables par l'utilisateur).
export type ClerkIdentity = {
  clerkId: string;
  email: string;
};

// Crée le compte Argos AI d'un utilisateur déjà authentifié par Clerk, au premier passage
// sur la page d'onboarding. Reprend la logique de l'ancienne inscription : organisation créée
// avec son admin, partages et invitations en attente rattachés, abonnement en attente.
export async function completeOnboarding(
  identity: ClerkIdentity,
  input: {
    firstName: unknown;
    lastName: unknown;
    accountType: unknown;
    organizationName: unknown;
  },
) {
  const { firstName, lastName, accountType, organizationName } = input;

  assertNonEmpty(firstName, "Le prénom");
  assertNonEmpty(lastName, "Le nom");
  assertValidAccountType(accountType);

  if (accountType === "organization") {
    assertNonEmpty(organizationName, "Le nom de l'organisation");
  }

  const normalizedEmail = identity.email.trim().toLowerCase();

  const existingByClerkId = await prisma.user.findUnique({ where: { clerkId: identity.clerkId } });
  if (existingByClerkId) {
    throw new AuthError("Ce compte a déjà été configuré.", 409);
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new AuthError("Un compte existe déjà avec cet email.", 409);
  }

  const {
    userId: createdUserId,
    organizationId: createdOrganizationId,
    joinedOrganization,
  } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        clerkId: identity.clerkId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        accountType,
        organizationName: accountType === "organization" ? (organizationName as string).trim() : null,
      },
    });

    let organizationId: string | null = null;
    let joinedOrganization = false;

    if (accountType === "organization") {
      const organization = await tx.organization.create({
        data: { name: (organizationName as string).trim() },
      });
      organizationId = organization.id;

      await tx.organizationMembership.create({
        data: { organizationId: organization.id, userId: user.id, role: "admin" },
      });
    }

    if (accountType === "personal") {
      await tx.projectShare.updateMany({
        where: { email: normalizedEmail, sharedWithUserId: null },
        data: { sharedWithUserId: user.id },
      });

      const invitation = await tx.organizationInvitation.findFirst({ where: { email: normalizedEmail } });
      if (invitation) {
        await tx.organizationMembership.create({
          data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
        });
        await tx.organizationInvitation.delete({ where: { id: invitation.id } });
        joinedOrganization = true;
      }
    }

    return { userId: user.id, organizationId, joinedOrganization };
  });

  // Créé après la transaction (appel réseau vers Stripe, à ne pas garder ouvert dans une
  // transaction DB) — un compte "organization" nouvellement créé n'a, à ce stade, jamais
  // encore de membership autre que le sien : l'abonnement Business est donc toujours porté
  // par l'organisation qu'il vient de créer, jamais par un membre qui la rejoint ensuite.
  // Un compte "personal" qui rejoint immédiatement une organisation via une invitation en
  // attente n'a pas non plus besoin de son propre abonnement Solo : il est déjà couvert par
  // l'abonnement Business de l'organisation qu'il vient de rejoindre.
  if (accountType === "organization" && createdOrganizationId) {
    await createPendingSubscription({
      ownerType: "organization",
      ownerId: createdOrganizationId,
      email: normalizedEmail,
      plan: "business",
    });
  } else if (accountType === "personal" && !joinedOrganization) {
    await createPendingSubscription({
      ownerType: "user",
      ownerId: createdUserId,
      email: normalizedEmail,
      plan: "solo",
    });
  }

  return prisma.user.findUniqueOrThrow({ where: { id: createdUserId }, include: { membership: true } });
}

export async function updatePhone(userId: string, phone: unknown) {
  // Un numéro vide efface le téléphone enregistré (désactive les SMS pour ce compte).
  if (phone === null || phone === "") {
    return prisma.user.update({ where: { id: userId }, data: { phone: null }, include: { membership: true } });
  }

  assertValidPhone(phone);

  return prisma.user.update({ where: { id: userId }, data: { phone }, include: { membership: true } });
}

// Comptes créés avant le passage à Clerk : à la première connexion Clerk, le compte Argos AI
// qui a le même email (vérifié par Clerk) est relié à ce clerkId. Uniquement s'il n'est relié
// à aucun autre compte Clerk, pour qu'un compte déjà relié ne puisse jamais être repris.
export async function linkExistingAccount(clerkId: string, verifiedEmail: string) {
  const user = await prisma.user.findUnique({ where: { email: verifiedEmail.trim().toLowerCase() } });
  if (!user || user.clerkId) {
    return null;
  }

  return prisma.user.update({ where: { id: user.id }, data: { clerkId }, select: { id: true } });
}

// Appelé par le webhook Clerk (user.updated) : garde l'email du compte Argos AI aligné sur
// l'email principal choisi chez Clerk, utilisé pour les notifications et Stripe.
export async function syncClerkUserEmail(clerkId: string, email: string) {
  return prisma.user.updateMany({ where: { clerkId }, data: { email: email.trim().toLowerCase() } });
}

