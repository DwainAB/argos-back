import "dotenv/config";
import fs from "node:fs";

// La clé privée GitHub App peut être fournie directement (variable d'env, avec des \n
// littéraux à la place des retours à la ligne) ou via un chemin vers le fichier .pem.
function loadGithubPrivateKey(): string {
  if (process.env.GITHUB_APP_PRIVATE_KEY) {
    return process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    return fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf-8");
  }
  return "";
}

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
  github: {
    appId: process.env.GITHUB_APP_ID ?? "",
    clientId: process.env.GITHUB_APP_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? "",
    slug: process.env.GITHUB_APP_SLUG ?? "",
    redirectUri: process.env.GITHUB_APP_REDIRECT_URI ?? "http://localhost:4000/api/integrations/github/callback",
    privateKey: loadGithubPrivateKey(),
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
  },
};
