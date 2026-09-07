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
import { projectSharesRouter } from "./routes/project-shares.route";
import { organizationRouter } from "./routes/organization.route";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { authMiddleware } from "./middlewares/auth.middleware";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter);

  app.use(authRouter);

  app.use(githubPublicRouter);

  app.use(authMiddleware);
  app.use(railwayIntegrationRouter);
  app.use(railwayProjectTokenRouter);
  app.use(logsRouter);
  app.use(alertsRouter);
  app.use(githubIntegrationRouter);
  app.use(projectSharesRouter);
  app.use(organizationRouter);

  app.use(notFoundMiddleware);

  return app;
}
