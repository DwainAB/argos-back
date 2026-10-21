import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/auth/auth.service", () => ({
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  changePassword: vi.fn(),
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  loginWithGitlab: vi.fn(),
  loginWithGithub: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signAuthToken: vi.fn().mockReturnValue("signed-token"),
  signup: vi.fn(),
  updatePhone: vi.fn(),
}));
vi.mock("../services/notifications/email.service", () => ({
  sendLoginNotificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/billing/subscription.service", () => ({ hasActiveAccess: vi.fn().mockReturnValue(false) }));
vi.mock("../services/auth/google-oauth.service", () => ({
  GoogleAuthError: class GoogleAuthError extends Error {},
  verifyGoogleIdToken: vi.fn(),
}));

import { authRouter } from "./auth.route";
import { AuthError, login, loginWithGithub, loginWithGitlab, signup, updatePhone } from "../services/auth/auth.service";
import { GoogleAuthError, verifyGoogleIdToken } from "../services/auth/google-oauth.service";

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

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(signup).mockReset();
  vi.mocked(login).mockReset();
  vi.mocked(loginWithGithub).mockReset();
  vi.mocked(loginWithGitlab).mockReset();
  vi.mocked(updatePhone).mockReset();
  vi.mocked(verifyGoogleIdToken).mockReset();
  prismaMock.subscription.findUnique.mockResolvedValue(null);
});

describe("POST /api/auth/signup", () => {
  const handler = getRouteHandler(authRouter, "post", "/api/auth/signup");

  it("crée le compte, pose le cookie de session et renvoie l'utilisateur", async () => {
    vi.mocked(signup).mockResolvedValue(makeUser() as never);
    const res = makeRes();

    await handler({ body: { email: "user@example.com" } } as never, res);

    expect(res.cookie).toHaveBeenCalledWith("argos_session", "signed-token", expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ user: expect.objectContaining({ email: "user@example.com" }) });
  });

  it("renvoie le code d'erreur d'une AuthError (ex: email déjà utilisé)", async () => {
    vi.mocked(signup).mockRejectedValue(new AuthError("Email déjà utilisé.", 409));
    const res = makeRes();

    await handler({ body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Email déjà utilisé." });
  });

  it("renvoie 500 sur une erreur inattendue", async () => {
    vi.mocked(signup).mockRejectedValue(new Error("boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();

    await handler({ body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(500);
    consoleError.mockRestore();
  });
});

describe("POST /api/auth/login", () => {
  const handler = getRouteHandler(authRouter, "post", "/api/auth/login");

  it("connecte l'utilisateur et pose le cookie de session", async () => {
    vi.mocked(login).mockResolvedValue(makeUser() as never);
    const res = makeRes();

    await handler({ body: { email: "user@example.com", password: "x" } } as never, res);

    expect(res.cookie).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ user: expect.objectContaining({ id: "user-1" }) });
  });

  it("renvoie 401 si les identifiants sont invalides", async () => {
    vi.mocked(login).mockRejectedValue(new AuthError("Identifiants invalides.", 401));
    const res = makeRes();

    await handler({ body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("POST /api/auth/logout", () => {
  const handler = getRouteHandler(authRouter, "post", "/api/auth/logout");

  it("efface le cookie de session et répond 204", async () => {
    const res = makeRes();

    handler({} as never, res);

    expect(res.clearCookie).toHaveBeenCalledWith("argos_session", expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});

describe("POST /api/auth/gitlab", () => {
  const handler = getRouteHandler(authRouter, "post", "/api/auth/gitlab");

  it("répond 400 si gitlabUserId est manquant", async () => {
    const res = makeRes();

    await handler({ body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(loginWithGitlab).not.toHaveBeenCalled();
  });

  it("connecte l'utilisateur avec un gitlabUserId valide", async () => {
    vi.mocked(loginWithGitlab).mockResolvedValue(makeUser() as never);
    const res = makeRes();

    await handler({ body: { gitlabUserId: "42", gitlabUserEmail: "x@y.com" } } as never, res);

    expect(loginWithGitlab).toHaveBeenCalledWith({ gitlabId: 42, email: "x@y.com" });
    expect(res.json).toHaveBeenCalled();
  });
});

describe("POST /api/auth/github", () => {
  const handler = getRouteHandler(authRouter, "post", "/api/auth/github");

  it("répond 400 si githubUserId est manquant", async () => {
    const res = makeRes();

    await handler({ body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("POST /api/auth/google", () => {
  const handler = getRouteHandler(authRouter, "post", "/api/auth/google");

  it("répond 401 si le token Google est invalide", async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(new GoogleAuthError("Token invalide"));
    const res = makeRes();

    await handler({ body: { idToken: "bad-token" } } as never, res);

    expect(res.status).toHaveBeenCalledWith(401);
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
