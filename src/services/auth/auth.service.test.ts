import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../billing/subscription.service", () => ({ createPendingSubscription: vi.fn() }));

import { AuthError, completeOnboarding, linkExistingAccount, syncClerkUserEmail, updatePhone } from "./auth.service";
import { createPendingSubscription } from "../billing/subscription.service";

// Base commune, surchargée au cas par cas selon le test — évite de retaper tous les champs
// obligatoires de User à chaque fois.
function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    clerkId: "clerk_user_1",
    email: "test@example.com",
    firstName: "Jean",
    lastName: "Dupont",
    phone: null,
    accountType: "personal",
    organizationName: null,
    hasUsedTrial: false,
    createdAt: new Date("2026-01-01"),
    membership: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(createPendingSubscription).mockReset();
  // Exécute réellement la callback passée à $transaction, avec le mock comme client tx.
  prismaMock.$transaction.mockImplementation(((arg: unknown) =>
    (arg as (tx: typeof prismaMock) => unknown)(prismaMock)) as typeof prismaMock.$transaction);
});

describe("completeOnboarding", () => {
  const identity = { clerkId: "clerk_new", email: "Nouveau@Example.com " };

  const validInput = {
    firstName: "Jean",
    lastName: "Dupont",
    accountType: "personal" as const,
    organizationName: undefined,
  };

  it("rejette un prénom vide", async () => {
    await expect(completeOnboarding(identity, { ...validInput, firstName: " " })).rejects.toThrow(AuthError);
  });

  it("rejette un type de compte invalide", async () => {
    await expect(completeOnboarding(identity, { ...validInput, accountType: "autre" })).rejects.toThrow(AuthError);
  });

  it("rejette un compte organisation sans nom d'organisation", async () => {
    await expect(
      completeOnboarding(identity, { ...validInput, accountType: "organization", organizationName: undefined })
    ).rejects.toThrow(AuthError);
  });

  it("rejette si ce compte Clerk a déjà terminé son onboarding", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(makeUser({ clerkId: "clerk_new" }) as never);

    await expect(completeOnboarding(identity, validInput)).rejects.toThrow("Ce compte a déjà été configuré.");
  });

  it("rejette si un compte existe déjà avec cet email", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(makeUser({ email: "nouveau@example.com" }) as never);

    await expect(completeOnboarding(identity, validInput)).rejects.toThrow("Un compte existe déjà avec cet email.");
  });

  it("enregistre le clerkId et l'email normalisé fournis par Clerk", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    prismaMock.user.create.mockResolvedValue(makeUser({ id: "new-user" }) as never);
    prismaMock.projectShare.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.organizationInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "new-user" }) as never);

    await completeOnboarding(identity, validInput);

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clerkId: "clerk_new", email: "nouveau@example.com" }),
    });
  });

  it("crée un compte personnel, lie les ProjectShare en attente et démarre un abonnement Solo", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never); // ni clerkId ni email déjà connus
    prismaMock.user.create.mockResolvedValue(makeUser({ id: "new-user" }) as never);
    prismaMock.projectShare.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.organizationInvitation.findFirst.mockResolvedValue(null);
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "new-user" }) as never);

    const user = await completeOnboarding(identity, validInput);

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
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    prismaMock.user.create.mockResolvedValue(makeUser({ id: "org-owner", accountType: "organization" }) as never);
    prismaMock.organization.create.mockResolvedValue({ id: "org-1", name: "Acme", createdAt: new Date() } as never);
    prismaMock.organizationMembership.create.mockResolvedValue({} as never);
    prismaMock.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "org-owner" }) as never);

    await completeOnboarding(identity, { ...validInput, accountType: "organization", organizationName: "Acme" });

    expect(prismaMock.organization.create).toHaveBeenCalledWith({ data: { name: "Acme" } });
    expect(prismaMock.organizationMembership.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "org-owner", role: "admin" },
    });
    expect(createPendingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "organization", ownerId: "org-1", plan: "business" })
    );
  });

  it("rattache automatiquement un compte personnel à une invitation d'organisation en attente, sans créer d'abonnement Solo", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
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

    await completeOnboarding(identity, validInput);

    expect(prismaMock.organizationMembership.create).toHaveBeenCalledWith({
      data: { organizationId: "org-existing", userId: "invited-user", role: "user" },
    });
    expect(prismaMock.organizationInvitation.delete).toHaveBeenCalledWith({ where: { id: "invit-1" } });
    expect(createPendingSubscription).not.toHaveBeenCalled();
  });
});

describe("updatePhone", () => {
  it("rejette un numéro qui n'est pas au format international", async () => {
    await expect(updatePhone("user-1", "0612345678")).rejects.toThrow(AuthError);
  });

  it("efface le numéro enregistré quand il est vide", async () => {
    prismaMock.user.update.mockResolvedValue(makeUser() as never);

    await updatePhone("user-1", "");

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { phone: null },
      include: { membership: true },
    });
  });
});

describe("linkExistingAccount", () => {
  it("relie le compte existant ayant cet email au clerkId", async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: "user-ancien", clerkId: null }) as never);
    prismaMock.user.update.mockResolvedValue({ id: "user-ancien" } as never);

    const linked = await linkExistingAccount("clerk_42", " Test@Example.com");

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: "test@example.com" } });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-ancien" },
      data: { clerkId: "clerk_42" },
      select: { id: true },
    });
    expect(linked).toEqual({ id: "user-ancien" });
  });

  it("ne reprend jamais un compte déjà relié à un autre compte Clerk", async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ clerkId: "clerk_autre" }) as never);

    await expect(linkExistingAccount("clerk_42", "test@example.com")).resolves.toBeNull();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("renvoie null si aucun compte n'a cet email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(linkExistingAccount("clerk_42", "inconnu@example.com")).resolves.toBeNull();
  });
});

describe("syncClerkUserEmail", () => {
  it("met à jour l'email normalisé du compte lié à ce clerkId", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as never);

    await syncClerkUserEmail("clerk_user_1", " Nouveau@Example.com");

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { clerkId: "clerk_user_1" },
      data: { email: "nouveau@example.com" },
    });
  });
});
