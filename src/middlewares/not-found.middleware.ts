import type { Request, Response } from "express";

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({ error: `Route non trouvée : ${req.method} ${req.originalUrl}` });
}
