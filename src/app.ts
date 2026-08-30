import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { healthRouter } from "./routes/health.route";
import { authRouter } from "./routes/auth.route";
import { railwayIntegrationRouter } from "./routes/railway-integration.route";
import { railwayProjectTokenRouter } from "./routes/railway-project-token.route";
import { logsRouter } from "./routes/logs.route";
import { alertsRouter } from "./routes/alerts.route";
import { githubPublicRouter, githubIntegrationRouter } from "./routes/github-integration.route";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { authMiddleware } from "./middlewares/auth.middleware";

// Construit l'application Express, sans la démarrer. Permet de la tester
// indépendamment d'un vrai serveur HTTP (utile pour les tests d'intégration futurs).
export function createApp() {
  const app = express();

  app.use(cors({ origin: env.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter);
  // Routes d'authentification : /signup et /login doivent rester accessibles sans
  // session ; /me applique elle-même authMiddleware (voir auth.route.ts).
  app.use(authRouter);
  // /start et /callback GitHub : appelées par navigation directe du navigateur (popup,
  // redirection depuis github.com), pas par un fetch avec le cookie de session
  // applicatif — doivent rester accessibles sans authMiddleware (voir leur commentaire
  // dans github-integration.route.ts).
  app.use(githubPublicRouter);

  // Tout ce qui suit nécessite une session valide (req.userId), chaque route filtrant
  // ensuite ses propres ressources par utilisateur.
  app.use(authMiddleware);
  app.use(railwayIntegrationRouter);
  app.use(railwayProjectTokenRouter);
  app.use(logsRouter);
  app.use(alertsRouter);
  app.use(githubIntegrationRouter);

  app.use(notFoundMiddleware);

  return app;
}
