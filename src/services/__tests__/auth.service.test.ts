import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../subscription.service", () => ({ createPendingSubscription: vi.fn() }));

import {
  AuthError,
  changePassword,
  hashPassword,
  login,
  loginWithGoogle,
  requestPasswordReset,
  resetPassword,
  signAuthToken,
  signup,
  verifyAuthToken,
  verifyPassword,
} from "../auth.service";
import { createPendingSubscription } from "../subscription.service";

// Base commune, surchargée au cas par cas selon le test — évite de retaper tous les champs
// obligatoires de User à chaque fois.
function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    firstName: "Jean",
    lastName: "Dupont",
    passwordHash: "hashed-password",
    phone: null,
    accountType: "personal",
    organizationName: null,
    hasUsedTrial: false,
    googleId: null,
    createdAt: new Date("2026-01-01"),
    membership: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(createPendingSubscription).mockReset();
  // $transaction est appelée par signup/resetPassword de deux façons différentes dans ce
  // service : avec une callback (signup) ou avec un tableau de requêtes (resetPassword).
  // Ce mock couvre les deux, en exécutant réellement la callback ou en résolvant le tableau.
  prismaMock.$transaction.mockImplementation(((arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prismaMock) => unknown)(prismaMock);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }) as typeof prismaMock.$transaction);
});

describe("hashPassword / verifyPassword", () => {
  it("hashe un mot de passe puis le vérifie avec succès", async () => {
    const hash = await hashPassword("un-mot-de-passe-solide");
    expect(hash).not.toBe("un-mot-de-passe-solide");
    await expect(verifyPassword("un-mot-de-passe-solide", hash)).resolves.toBe(true);
  });

  it("rejette un mauvais mot de passe face à un hash existant", async () => {
    const hash = await hashPassword("bon-mot-de-passe");
    await expect(verifyPassword("mauvais-mot-de-passe", hash)).resolves.toBe(false);
  });
});

describe("signAuthToken / verifyAuthToken", () => {
  it("signe un token qui se vérifie et redonne le bon userId", () => {
    const token = signAuthToken("user-42");
    expect(verifyAuthToken(token)).toBe("user-42");
  });

  it("rejette un token invalide sans lever d'exception", () => {
    expect(verifyAuthToken("token.invalide.tototo")).toBeNull();
  });
});

describe("signup", () => {
  const validInput = {
    email: "nouveau@example.com",
    password: "un-mot-de-passe-solide",
    firstName: "Jean",
    lastName: "Dupont",
    accountType: "personal" as const,
    organizationName: undefined,
  };

  it("rejette un email invalide", async () => {
    await expect(signup({ ...validInput, email: "pas-un-email" })).rejects.toThrow(AuthError);
  });

  it("rejette un mot de passe trop court", async () => {
    await expect(signup({ ...validInput, password: "court" })).rejects.toThrow(AuthError);
  });

  it("rejette un compte organisation sans nom d'organisation", async () => {
    await expect(
      signup({ ...validInput, accountType: "organization", organizationName: undefined })
    ).rejects.toThrow(AuthError);
  });

  it("rejette si un compte existe déjà avec cet email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ email: "nouveau@example.com" }) as never);

    await expect(signup(validInput)).rejects.toThrow("Un compte existe déjà avec cet email.");
  });

  it("crée un compte personnel, lie les ProjectShare en attente et démarre un abonnement Solo", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never); // pas de doublon
    prismaMock.user.create.mockResolvedValue(makeUser({ id: "new-user" }) as never);
    prismaMock.projectShare.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.organizationInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "new-user" }) as never);

    const user = await signup(validInput);

    expect(user.id).toBe("new-user");
    expect(prismaMock.projectShare.updateMany).toHaveBeenCalledWith({
      where: { email: "nouveau@example.com", sharedWithUserId: null },
      data: { sharedWithUserId: "new-user" },
    });
    expect(createPendingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "user", ownerId: "new-user", plan: "solo" })
    );
  });

  it("crée une organisation et un abonnement Business pour un compte organisation", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never);
    prismaMock.user.create.mockResolvedValue(makeUser({ id: "org-owner", accountType: "organization" }) as never);
    prismaMock.organization.create.mockResolvedValue({ id: "org-1", name: "Acme", createdAt: new Date() } as never);
    prismaMock.organizationMembership.create.mockResolvedValue({} as never);
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "org-owner" }) as never);

    await signup({ ...validInput, accountType: "organization", organizationName: "Acme" });

    expect(prismaMock.organization.create).toHaveBeenCalledWith({ data: { name: "Acme" } });
    expect(prismaMock.organizationMembership.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "org-owner", role: "admin" },
    });
    expect(createPendingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "organization", ownerId: "org-1", plan: "business" })
    );
  });

  it("rattache automatiquement un compte personnel à une invitation d'organisation en attente, sans créer d'abonnement Solo", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never);
    prismaMock.user.create.mockResolvedValue(makeUser({ id: "invited-user" }) as never);
    prismaMock.projectShare.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.organizationInvitation.findFirst.mockResolvedValue({
      id: "invit-1",
      organizationId: "org-existing",
      email: "nouveau@example.com",
      role: "user",
      createdAt: new Date(),
    } as never);
    prismaMock.organizationMembership.create.mockResolvedValue({} as never);
    prismaMock.organizationInvitation.delete.mockResolvedValue({} as never);
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "invited-user" }) as never);

    await signup(validInput);

    expect(prismaMock.organizationMembership.create).toHaveBeenCalledWith({
      data: { organizationId: "org-existing", userId: "invited-user", role: "user" },
    });
    expect(prismaMock.organizationInvitation.delete).toHaveBeenCalledWith({ where: { id: "invit-1" } });
    expect(createPendingSubscription).not.toHaveBeenCalled();
  });
});

describe("login", () => {
  it("rejette un email invalide", async () => {
    await expect(login({ email: "pas-un-email", password: "abcdefgh" })).rejects.toThrow(AuthError);
  });

  it("rejette un mot de passe vide", async () => {
    await expect(login({ email: "test@example.com", password: "" })).rejects.toThrow(AuthError);
  });

  it("rejette si aucun compte n'existe avec cet email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(login({ email: "inconnu@example.com", password: "abcdefgh" })).rejects.toThrow(
      "Email ou mot de passe incorrect."
    );
  });

  it("rejette si le mot de passe ne correspond pas au hash stocké", async () => {
    const hash = await hashPassword("bon-mot-de-passe");
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ passwordHash: hash }) as never);

    await expect(login({ email: "test@example.com", password: "mauvais-mot-de-passe" })).rejects.toThrow(
      "Email ou mot de passe incorrect."
    );
  });

  it("connecte l'utilisateur si l'email et le mot de passe correspondent", async () => {
    const hash = await hashPassword("bon-mot-de-passe");
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ passwordHash: hash }) as never);

    const user = await login({ email: "test@example.com", password: "bon-mot-de-passe" });

    expect(user.email).toBe("test@example.com");
  });
});

describe("changePassword", () => {
  it("rejette si le mot de passe actuel est incorrect", async () => {
    const hash = await hashPassword("bon-mot-de-passe");
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ passwordHash: hash }) as never);

    await expect(
      changePassword("user-1", { currentPassword: "mauvais", newPassword: "nouveau-mot-de-passe" })
    ).rejects.toThrow("Mot de passe actuel incorrect.");
  });

  it("rejette un nouveau mot de passe trop court", async () => {
    const hash = await hashPassword("bon-mot-de-passe");
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ passwordHash: hash }) as never);

    await expect(
      changePassword("user-1", { currentPassword: "bon-mot-de-passe", newPassword: "court" })
    ).rejects.toThrow(AuthError);
  });

  it("met à jour le mot de passe si l'actuel est correct", async () => {
    const hash = await hashPassword("bon-mot-de-passe");
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ passwordHash: hash }) as never);
    prismaMock.user.update.mockResolvedValue(makeUser() as never);

    await changePassword("user-1", { currentPassword: "bon-mot-de-passe", newPassword: "nouveau-mot-de-passe" });

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } })
    );
  });
});

describe("requestPasswordReset", () => {
  it("ne révèle rien et ne crée aucun jeton si l'email ne correspond à aucun compte", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await requestPasswordReset("inconnu@example.com");

    expect(result).toBeNull();
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("crée un jeton hashé (jamais en clair) pour un compte existant", async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser() as never);
    prismaMock.passwordResetToken.create.mockResolvedValue({} as never);

    const result = await requestPasswordReset("test@example.com");

    expect(result).not.toBeNull();
    expect(result?.token).toHaveLength(64); // 32 bytes en hex
    const createCall = prismaMock.passwordResetToken.create.mock.calls[0][0];
    expect(createCall.data.tokenHash).not.toBe(result?.token);
  });
});

describe("resetPassword", () => {
  it("rejette un jeton inconnu", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(resetPassword({ token: "inconnu", newPassword: "nouveau-mot-de-passe" })).rejects.toThrow(
      "Ce lien de réinitialisation est invalide ou expiré."
    );
  });

  it("rejette un jeton déjà utilisé", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
      createdAt: new Date(),
    });

    await expect(resetPassword({ token: "abc", newPassword: "nouveau-mot-de-passe" })).rejects.toThrow(
      "Ce lien de réinitialisation est invalide ou expiré."
    );
  });

  it("rejette un jeton expiré", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
      createdAt: new Date(),
    });

    await expect(resetPassword({ token: "abc", newPassword: "nouveau-mot-de-passe" })).rejects.toThrow(
      "Ce lien de réinitialisation est invalide ou expiré."
    );
  });

  it("met à jour le mot de passe et marque le jeton comme utilisé pour un jeton valide", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    prismaMock.user.update.mockResolvedValue(makeUser() as never);
    prismaMock.passwordResetToken.update.mockResolvedValue({} as never);

    await resetPassword({ token: "abc", newPassword: "nouveau-mot-de-passe" });

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } })
    );
    expect(prismaMock.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reset-1" }, data: { usedAt: expect.any(Date) } })
    );
  });
});

describe("loginWithGoogle", () => {
  it("reconnaît directement un compte déjà lié par googleId", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(makeUser({ googleId: "google-123" }) as never);

    const user = await loginWithGoogle({ googleId: "google-123", email: "test@example.com" });

    expect(user.googleId).toBe("google-123");
  });

  it("lie automatiquement un compte existant par email si le googleId n'est pas encore connu", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null as never) // pas trouvé par googleId
      .mockResolvedValueOnce(makeUser({ id: "user-1" }) as never); // trouvé par email
    prismaMock.user.update.mockResolvedValue(makeUser({ id: "user-1", googleId: "google-123" }) as never);

    await loginWithGoogle({ googleId: "google-123", email: "test@example.com" });

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" }, data: { googleId: "google-123" } })
    );
  });

  it("ne crée jamais de compte : rejette si aucun compte n'existe avec cet email", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);

    await expect(loginWithGoogle({ googleId: "google-999", email: "inconnu@example.com" })).rejects.toThrow(
      "Aucun compte associé à cette adresse email. Créez d'abord un compte."
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
