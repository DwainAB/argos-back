import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "",
  railway: {
    // Project Token de test, utilisé par scripts/test-railway-logs.ts.
    projectToken: process.env.RAILWAY_PROJECT_TOKEN ?? "",
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? "",
    serviceId: process.env.RAILWAY_SERVICE_ID ?? "",
    // OAuth App ("Login with Railway"), utilisée pour la connexion utilisateur réelle.
    oauthClientId: process.env.RAILWAY_OAUTH_CLIENT_ID ?? "",
    oauthClientSecret: process.env.RAILWAY_OAUTH_CLIENT_SECRET ?? "",
    oauthRedirectUri:
      process.env.RAILWAY_OAUTH_REDIRECT_URI ?? "http://localhost:4000/api/integrations/railway/callback",
  },
};
