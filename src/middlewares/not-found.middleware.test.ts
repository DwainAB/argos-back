import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { notFoundMiddleware } from "./not-found.middleware";

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("notFoundMiddleware", () => {
  it("répond 404 avec la méthode et l'URL de la route demandée", () => {
    const req = { method: "POST", originalUrl: "/api/inconnu" } as Request;
    const res = makeRes();

    notFoundMiddleware(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Route non trouvée : POST /api/inconnu" });
  });
});
