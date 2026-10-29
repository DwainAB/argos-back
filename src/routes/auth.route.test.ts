import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  getAuth: vi.fn(),
}));
vi.mock("../services/auth/auth.service", () => ({
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  completeOnboarding: vi.fn(),
  updatePhone: vi.fn(),
}));
vi.mock("../services/notifications/email.service", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/billing/subscription.service", () => ({ hasActiveAccess: vi.fn().mockReturnValue(false) }));

import { clerkClient } from "@clerk/express";
import { authRouter } from "./auth.route";
import { AuthError, completeOnboarding, updatePhone } from "../services/auth/auth.service";
import { sendWelcomeEmail } from "../services/notifications/email.service";

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    firstName: "Jean",
    lastName: "Dupont",
    phone: null,
    accountType: "personal",
    organizationName: null,
    createdAt: new Date("2026-01-01"),
    membership: null,
    ...overrides,
  };
}

function mockClerkUser(primaryEmail: string | null) {
  vi.mocked(clerkClient.users.getUser).mockResolvedValue({
    id: "clerk_1",
    primaryEmailAddress: primaryEmail ? { emailAddress: primaryEmail } : null,
  } as never);
}

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(completeOnboarding).mockReset();
  vi.mocked(updatePhone).mockReset();
  vi.mocked(clerkClient.users.getUser).mockReset();
  vi.mocked(sendWelcomeEmail).mockClear();
  prismaMock.subscription.findUnique.mockResolvedValue(null);
});

describe("POST /api/auth/onboarding", () => {
  const handler = getRouteHandler(authRouter, "post", "/api/auth/onboarding");

  it("crée le compte à partir de l'identité Clerk, envoie l'email de bienvenue et renvoie l'utilisateur", async () => {
    mockClerkUser("user@example.com");
    vi.mocked(completeOnboarding).mockResolvedValue(makeUser() as never);
    const res = makeRes();
    const body = { firstName: "Jean", lastName: "Dupont", accountType: "personal", email: "pirate@example.com" };

    await handler({ clerkUserId: "clerk_1", body } as never, res);

    // L'email vient toujours de Clerk, jamais du corps de la requête.
    expect(completeOnboarding).toHaveBeenCalledWith({ clerkId: "clerk_1", email: "user@example.com" }, body);
    expect(sendWelcomeEmail).toHaveBeenCalledWith({ to: "user@example.com", firstName: "Jean" });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ user: expect.objectContaining({ email: "user@example.com" }) });
  });

  it("répond 400 si le compte Clerk n'a pas d'email principal", async () => {
    mockClerkUser(null);
    const res = makeRes();

    await handler({ clerkUserId: "clerk_1", body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("renvoie le code d'erreur d'une AuthError (ex: email déjà utilisé)", async () => {
    mockClerkUser("user@example.com");
    vi.mocked(completeOnboarding).mockRejectedValue(new AuthError("Email déjà utilisé.", 409));
    const res = makeRes();

    await handler({ clerkUserId: "clerk_1", body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Email déjà utilisé." });
  });

  it("renvoie 500 sur une erreur inattendue", async () => {
    vi.mocked(clerkClient.users.getUser).mockRejectedValue(new Error("boom"));
    const res = makeRes();

    await handler({ clerkUserId: "clerk_1", body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("GET /api/auth/me", () => {
  const handler = getRouteHandler(authRouter, "get", "/api/auth/me");

  it("renvoie 401 si l'utilisateur n'existe plus en base", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("renvoie l'utilisateur courant", async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser() as never);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ user: expect.objectContaining({ id: "user-1" }) });
  });
});

describe("PATCH /api/auth/me", () => {
  const handler = getRouteHandler(authRouter, "patch", "/api/auth/me");

  it("met à jour le numéro de téléphone", async () => {
    vi.mocked(updatePhone).mockResolvedValue(makeUser({ phone: "+33600000000" }) as never);
    const res = makeRes();

    await handler({ userId: "user-1", body: { phone: "+33600000000" } } as never, res);

    expect(updatePhone).toHaveBeenCalledWith("user-1", "+33600000000");
    expect(res.json).toHaveBeenCalled();
  });
});
