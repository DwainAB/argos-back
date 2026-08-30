import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

// Nombre de tours de salage bcrypt. 10 est la valeur recommandée par défaut (bon
// compromis coût/sécurité), pas besoin de monter plus haut pour ce cas d'usage.
const BCRYPT_ROUNDS = 10;

// Durée de vie du token de session, alignée sur la durée du cookie posé par les routes
// (voir auth.route.ts).
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

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signAuthToken(userId: string) {
  return jwt.sign({ sub: userId }, env.auth.jwtSecret, { expiresIn: TOKEN_TTL });
}

// Renvoie l'id utilisateur porté par le token, ou null s'il est absent/invalide/expiré.
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

// Crée un compte utilisateur après validation des champs et vérification de l'unicité de
// l'email. Lève une AuthError (avec statusCode) en cas de champ invalide ou d'email déjà pris.
export async function signup(input: { email: unknown; password: unknown; firstName: unknown; lastName: unknown }) {
  const { email, password, firstName, lastName } = input;

  assertValidEmail(email);
  assertValidPassword(password);
  assertNonEmpty(firstName, "Le prénom");
  assertNonEmpty(lastName, "Le nom");

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new AuthError("Un compte existe déjà avec cet email.", 409);
  }

  const passwordHash = await hashPassword(password);

  return prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    },
  });
}

// Vérifie les identifiants et renvoie l'utilisateur correspondant. Lève une AuthError
// générique (même message pour email inconnu ou mot de passe incorrect) pour ne pas
// révéler si un email est enregistré ou non.
export async function login(input: { email: unknown; password: unknown }) {
  const { email, password } = input;

  assertValidEmail(email);
  assertNonEmpty(password, "Le mot de passe");

  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    throw new AuthError("Email ou mot de passe incorrect.", 401);
  }

  const passwordMatches = await verifyPassword(password as string, user.passwordHash);
  if (!passwordMatches) {
    throw new AuthError("Email ou mot de passe incorrect.", 401);
  }

  return user;
}
