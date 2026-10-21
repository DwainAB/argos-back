import type { Request, Response, Router } from "express";
import { vi } from "vitest";

// Permet d'appeler directement le handler d'une route Express enregistrée sur un Router,
// sans lancer de vrai serveur HTTP ni dépendre de supertest (absent du projet) — on retrouve
// le handler dans router.stack (API interne d'Express mais stable depuis des années) par
// méthode + chemin, puis on l'invoque avec des req/res minimalistes.
export function getRouteHandler(router: Router, method: "get" | "post" | "put" | "delete" | "patch", path: string) {
  const layer = (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack.find(
    (entry) => entry.route?.path === path && entry.route.methods[method],
  );

  if (!layer?.route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} introuvable sur ce router.`);
  }

  const stack = (layer.route as unknown as { stack: { handle: (req: Request, res: Response) => unknown }[] }).stack;
  return stack[stack.length - 1].handle;
}

export function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.cookie = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as Response;
}
