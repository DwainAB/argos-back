import "dotenv/config";
import fs from "node:fs";

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
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? "dev-secret-a-ne-jamais-utiliser-en-production",
  },
  railway: {
    projectToken: process.env.RAILWAY_PROJECT_TOKEN ?? "",
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? "",
    serviceId: process.env.RAILWAY_SERVICE_ID ?? "",
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
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4.1",
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    fromEmail: process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    fromPhoneNumber: process.env.TWILIO_FROM_PHONE_NUMBER ?? "",
    // Compte trial (aucune carte ajoutée) : Twilio n'accepte que ses templates prédéfinis,
    // pas de texte libre. À passer à "false" une fois le compte upgradé (voir sms.service.ts).
    trialMode: process.env.TWILIO_TRIAL_MODE !== "false",
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    // IDs des Price Stripe (Dashboard > Product catalog), un par plan/intervalle.
    priceSolo: process.env.STRIPE_PRICE_SOLO ?? "",
    priceBusiness: process.env.STRIPE_PRICE_BUSINESS ?? "",
  },
};
