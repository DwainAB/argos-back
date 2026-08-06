import type { Request, Response } from "express";

// Middleware placé après toutes les routes : capture les requêtes vers une route inexistante.
export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({ error: `Route non trouvée : ${req.method} ${req.originalUrl}` });
}
