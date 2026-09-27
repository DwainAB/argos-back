import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { healthRouter } from "./routes/health.route";
import { authRouter } from "./routes/auth.route";
import { railwayIntegrationRouter } from "./routes/railway-integration.route";
import { renderIntegrationRouter } from "./routes/render-integration.route";
import { renderApiKeysRouter } from "./routes/render-api-keys.route";
import { githubConnectionsRouter } from "./routes/github-connections.route";
import { projectsRouter } from "./routes/projects.route";
import { logsRouter } from "./routes/logs.route";
import { alertsRouter } from "./routes/alerts.route";
import { codeAnalysisRouter } from "./routes/code-analysis.route";
import { githubPublicRouter, githubIntegrationRouter } from "./routes/github-integration.route";
import { gitlabPublicRouter, gitlabIntegrationRouter } from "./routes/gitlab-integration.route";
import { gitlabConnectionsRouter } from "./routes/gitlab-connections.route";
import { projectSharesRouter } from "./routes/project-shares.route";
import { organizationRouter } from "./routes/organization.route";
import { subscriptionRouter } from "./routes/subscription.route";
import { planChangeRouter } from "./routes/plan-change.route";
import { stripeWebhookRouter } from "./routes/stripe-webhook.route";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { authMiddleware } from "./middlewares/auth.middleware";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.frontendUrl, credentials: true }));

  // Monté avant express.json() : Stripe a besoin du corps brut, non parsé, pour vérifier
  // la signature de la requête (voir stripe-webhook.route.ts).
  app.use(stripeWebhookRouter);

  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter);

  app.use(authRouter);

  app.use(githubPublicRouter);
  app.use(gitlabPublicRouter);

  app.use(authMiddleware);
  app.use(railwayIntegrationRouter);
  app.use(renderIntegrationRouter);
  app.use(renderApiKeysRouter);
  app.use(githubConnectionsRouter);
  app.use(gitlabConnectionsRouter);
  app.use(projectsRouter);
  app.use(logsRouter);
  app.use(alertsRouter);
  app.use(codeAnalysisRouter);
  app.use(githubIntegrationRouter);
  app.use(gitlabIntegrationRouter);
  app.use(projectSharesRouter);
  app.use(organizationRouter);
  app.use(subscriptionRouter);
  app.use(planChangeRouter);

  app.use(notFoundMiddleware);

  return app;
}
