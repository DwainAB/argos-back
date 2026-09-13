import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { createPendingSubscription } from "./subscription.service";

const BCRYPT_ROUNDS = 10;

const TOKEN_TTL = "7d";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Format E.164 (ex: +33612345678), requis par Twilio pour l'envoi de SMS.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

function assertValidEmail(email: unknown): asserts email is string {
  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    throw new AuthError("Adresse email invalide.", 400);
  }
}

function assertValidPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`, 400);
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

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signAuthToken(userId: string) {
  return jwt.sign({ sub: userId }, env.auth.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function verifyAuthToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.auth.jwtSecret);
    if (typeof payload === "object" && payload !== null && typeof payload.sub === "string") {
      return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

export async function signup(input: {
  email: unknown;
  password: unknown;
  firstName: unknown;
  lastName: unknown;
  accountType: unknown;
  organizationName: unknown;
}) {
  const { email, password, firstName, lastName, accountType, organizationName } = input;

  assertValidEmail(email);
  assertValidPassword(password);
  assertNonEmpty(firstName, "Le prénom");
  assertNonEmpty(lastName, "Le nom");
  assertValidAccountType(accountType);

  if (accountType === "organization") {
    assertNonEmpty(organizationName, "Le nom de l'organisation");
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new AuthError("Un compte existe déjà avec cet email.", 409);
  }

  const passwordHash = await hashPassword(password);

  const {
    userId: createdUserId,
    organizationId: createdOrganizationId,
    joinedOrganization,
  } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
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

export async function changePassword(userId: string, input: { currentPassword: unknown; newPassword: unknown }) {
  const { currentPassword, newPassword } = input;

  assertNonEmpty(currentPassword, "Le mot de passe actuel");
  assertValidPassword(newPassword);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const currentPasswordMatches = await verifyPassword(currentPassword as string, user.passwordHash);
  if (!currentPasswordMatches) {
    throw new AuthError("Mot de passe actuel incorrect.", 401);
  }

  const passwordHash = await hashPassword(newPassword);

  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
    include: { membership: true },
  });
}

export async function updatePhone(userId: string, phone: unknown) {
  // Un numéro vide efface le téléphone enregistré (désactive les SMS pour ce compte).
  if (phone === null || phone === "") {
    return prisma.user.update({ where: { id: userId }, data: { phone: null }, include: { membership: true } });
  }

  assertValidPhone(phone);

  return prisma.user.update({ where: { id: userId }, data: { phone }, include: { membership: true } });
}

export async function login(input: { email: unknown; password: unknown }) {
  const { email, password } = input;

  assertValidEmail(email);
  assertNonEmpty(password, "Le mot de passe");

  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, include: { membership: true } });
  if (!user) {
    throw new AuthError("Email ou mot de passe incorrect.", 401);
  }

  const passwordMatches = await verifyPassword(password as string, user.passwordHash);
  if (!passwordMatches) {
    throw new AuthError("Email ou mot de passe incorrect.", 401);
  }

  return user;
}
