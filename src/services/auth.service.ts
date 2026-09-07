import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

const BCRYPT_ROUNDS = 10;

const TOKEN_TTL = "7d";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

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

  const createdUserId = await prisma.$transaction(async (tx) => {
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

    if (accountType === "organization") {
      const organization = await tx.organization.create({
        data: { name: (organizationName as string).trim() },
      });

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
      }
    }

    return user.id;
  });

  return prisma.user.findUniqueOrThrow({ where: { id: createdUserId }, include: { membership: true } });
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
