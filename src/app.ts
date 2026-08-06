import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.route";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";

// Construit l'application Express, sans la démarrer. Permet de la tester
// indépendamment d'un vrai serveur HTTP (utile pour les tests d'intégration futurs).
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use(healthRouter);

  app.use(notFoundMiddleware);

  return app;
}
