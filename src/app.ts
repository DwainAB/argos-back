import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { healthRouter } from "./routes/health.route";
import { railwayIntegrationRouter } from "./routes/railway-integration.route";
import { railwayProjectTokenRouter } from "./routes/railway-project-token.route";
import { logsRouter } from "./routes/logs.route";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";

// Construit l'application Express, sans la démarrer. Permet de la tester
// indépendamment d'un vrai serveur HTTP (utile pour les tests d'intégration futurs).
export function createApp() {
  const app = express();

  app.use(cors({ origin: env.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter);
  app.use(railwayIntegrationRouter);
  app.use(railwayProjectTokenRouter);
  app.use(logsRouter);

  app.use(notFoundMiddleware);

  return app;
}
