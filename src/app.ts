import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { clerkMiddleware } from "@clerk/express";
import swaggerUi from "swagger-ui-express";
import YAML from "js-yaml";
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
import { clerkWebhookRouter } from "./routes/clerk-webhook.route";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { authMiddleware } from "./middlewares/auth.middleware";


export function createApp() {
  const app = express();

  // Autorise uniquement le frontend d'argos à appeler l'API.
  app.use(cors({ origin: env.frontendUrl, credentials: true }));

  // Webhooks Stripe et Clerk pour recevoir les notifications avant la lecture du json
  app.use(stripeWebhookRouter);
  app.use(clerkWebhookRouter);

  // Middleware pour parser le JSON
  app.use(express.json());
  // Cookies : utilisés pour le "state" des connexions OAuth (GitHub, GitLab, Railway).
  app.use(cookieParser());

  // Identifie qui fait la requête
  app.use(clerkMiddleware());

  // GET /health : permet à Railway de vérifier que l'API tourne.
  app.use(healthRouter);

  // Documentation Swagger publique, générée depuis openapi.yaml.
  const openapiYaml = fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf-8");
  const openapiDocument = YAML.load(openapiYaml) as Record<string, unknown>;
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

  // Onboarding et utilisateur courant : chaque route gère son propre contrôle d'accès.
  app.use(authRouter);

  // Retours OAuth GitHub/GitLab : appelés par redirection, sans token, donc publics.
  app.use(githubPublicRouter);
  app.use(gitlabPublicRouter);

  // ⛔ Toutes les routes en dessous exigent un utilisateur connecté avec un compte Argos AI.
  app.use(authMiddleware);

  // Intégrations : hébergeurs (Railway, Render) et dépôts (GitHub, GitLab).
  app.use(railwayIntegrationRouter);
  app.use(renderIntegrationRouter);
  app.use(renderApiKeysRouter);
  app.use(githubConnectionsRouter);
  app.use(gitlabConnectionsRouter);

  // Projets, logs, alertes et analyse de code.
  app.use(projectsRouter);
  app.use(logsRouter);
  app.use(alertsRouter);
  app.use(codeAnalysisRouter);
  app.use(githubIntegrationRouter);
  app.use(gitlabIntegrationRouter);

  // Partage de projets et organisation.
  app.use(projectSharesRouter);
  app.use(organizationRouter);

  // Abonnement Stripe.
  app.use(subscriptionRouter);
  app.use(planChangeRouter);

  // Aucune route n'a répondu : 404 en JSON.
  app.use(notFoundMiddleware);

  return app;
}
