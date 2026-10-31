import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@clerk/express", () => ({ getAuth: vi.fn(), clerkClient: { users: { getUser: vi.fn() } } }));
vi.mock("../services/auth/auth.service", () => ({ linkExistingAccount: vi.fn() }));

import { clerkClient, getAuth } from "@clerk/express";
import { linkExistingAccount } from "../services/auth/auth.service";
import { authMiddleware, clerkSessionMiddleware, ONBOARDING_REQUIRED } from "./auth.middleware";

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function mockClerkUserId(clerkUserId: string | null) {
  vi.mocked(getAuth).mockReturnValue({ userId: clerkUserId } as ReturnType<typeof getAuth>);
}

function mockClerkEmail(status: "verified" | "unverified") {
  vi.mocked(clerkClient.users.getUser).mockResolvedValue({
    primaryEmailAddress: { emailAddress: "ancien@example.com", verification: { status } },
  } as never);
}

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(getAuth).mockReset();
  vi.mocked(clerkClient.users.getUser).mockReset();
  vi.mocked(linkExistingAccount).mockReset().mockResolvedValue(null);
});

describe("clerkSessionMiddleware", () => {
  it("répond 401 sans session Clerk valide", () => {
    mockClerkUserId(null);
    const res = makeRes();
    const next = vi.fn();

    clerkSessionMiddleware({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("expose clerkUserId sans exiger de compte Argos AI", () => {
    mockClerkUserId("clerk_42");
    const req = {} as Request;
    const next = vi.fn();

    clerkSessionMiddleware(req, makeRes(), next);

    expect(req.clerkUserId).toBe("clerk_42");
    expect(next).toHaveBeenCalled();
  });
});

describe("authMiddleware", () => {
  it("répond 401 sans session Clerk valide", async () => {
    mockClerkUserId(null);
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentification requise." });
    expect(next).not.toHaveBeenCalled();
  });

  it("répond 403 ONBOARDING_REQUIRED si la session Clerk n'a pas encore de compte Argos AI", async () => {
    mockClerkUserId("clerk_42");
    mockClerkEmail("verified");
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: ONBOARDING_REQUIRED }));
    expect(next).not.toHaveBeenCalled();
  });

  it("relie un compte créé avant Clerk via l'email vérifié et laisse passer la requête", async () => {
    mockClerkUserId("clerk_42");
    mockClerkEmail("verified");
    prismaMock.user.findUnique.mockResolvedValue(null);
    vi.mocked(linkExistingAccount).mockResolvedValue({ id: "user-ancien" } as never);
    const req = {} as Request;
    const next = vi.fn();

    await authMiddleware(req, makeRes(), next);

    expect(linkExistingAccount).toHaveBeenCalledWith("clerk_42", "ancien@example.com");
    expect(req.userId).toBe("user-ancien");
    expect(next).toHaveBeenCalledWith();
  });

  it("ne tente aucune liaison si l'email Clerk n'est pas vérifié", async () => {
    mockClerkUserId("clerk_42");
    mockClerkEmail("unverified");
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = makeRes();

    await authMiddleware({} as Request, res, vi.fn());

    expect(linkExistingAccount).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("injecte userId et clerkUserId puis passe la main si le compte existe", async () => {
    mockClerkUserId("clerk_42");
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-42" } as never);
    const req = {} as Request;
    const next = vi.fn();

    await authMiddleware(req, makeRes(), next);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { clerkId: "clerk_42" }, select: { id: true } });
    expect(req.userId).toBe("user-42");
    expect(req.clerkUserId).toBe("clerk_42");
    expect(next).toHaveBeenCalledWith();
  });
});
