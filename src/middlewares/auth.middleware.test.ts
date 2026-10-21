import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/auth/auth.service", () => ({ verifyAuthToken: vi.fn() }));

import { verifyAuthToken } from "../services/auth/auth.service";
import { authMiddleware, SESSION_COOKIE } from "./auth.middleware";

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  vi.mocked(verifyAuthToken).mockReset();
});

describe("authMiddleware", () => {
  it("répond 401 si aucun cookie de session n'est présent", () => {
    const req = { cookies: {} } as Request;
    const res = makeRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentification requise." });
    expect(next).not.toHaveBeenCalled();
  });

  it("répond 401 si le token est présent mais invalide", () => {
    vi.mocked(verifyAuthToken).mockReturnValue(null);
    const req = { cookies: { [SESSION_COOKIE]: "token-invalide" } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("pose req.userId et appelle next() si le token est valide", () => {
    vi.mocked(verifyAuthToken).mockReturnValue("user-42");
    const req = { cookies: { [SESSION_COOKIE]: "token-valide" } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(req.userId).toBe("user-42");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
