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
  // Clé symétrique (32 octets, encodée en base64 ou hex) servant à chiffrer les secrets
  // sensibles stockés en base (ex: clés API Render) — voir lib/encryption.ts. À générer une
  // seule fois par environnement (ex: `openssl rand -base64 32`) et ne jamais faire tourner
  // sans plan de re-chiffrement des données existantes.
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
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
  // Application OAuth2 GitLab (gitlab.com > Edit profile > Applications, ou au niveau d'un
  // groupe) — flow OAuth2 classique, à la différence de la GitHub App (installation-based).
  // Créer l'Application avec le scope "api" (lecture+écriture, voir gitlab-oauth.service.ts)
  // et cette redirectUri.
  gitlab: {
    baseUrl: process.env.GITLAB_BASE_URL ?? "https://gitlab.com",
    clientId: process.env.GITLAB_APP_CLIENT_ID ?? "",
    clientSecret: process.env.GITLAB_APP_CLIENT_SECRET ?? "",
    redirectUri: process.env.GITLAB_APP_REDIRECT_URI ?? "http://localhost:4000/api/integrations/gitlab/callback",
  },
  // Groq (console.groq.com) : héberge le triage/l'explication des logs — remplace l'IA
  // locale Ollama initialement prévue (voir CAHIER_DES_CHARGES.md, décision du 2026-09-13).
  // API compatible OpenAI, d'où le baseURL pointé dessus avec le SDK openai déjà en dépendance.
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? "",
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4.1",
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    fromEmail: process.env.RESEND_FROM_EMAIL ?? "no-reply@ai-argos.com",
    alertFromEmail: process.env.RESEND_ALERT_FROM_EMAIL ?? "alerts@ai-argos.com",
  },
  smsfactor: {
    apiToken: process.env.SMSFACTOR_API_TOKEN ?? "",
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    // IDs des Price Stripe (Dashboard > Product catalog), un par plan/intervalle.
    priceSolo: process.env.STRIPE_PRICE_SOLO ?? "",
    priceBusiness: process.env.STRIPE_PRICE_BUSINESS ?? "",
  },
  google: {
    // Flux 100% frontend (Google Identity Services, bouton "Continuer avec Google" du
    // login) : un id_token est vérifié côté serveur avec ce seul Client ID, jamais de
    // client_secret ni d'échange de code — voir google-oauth.service.ts.
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
  },
  logRetention: {
    // Durée de conservation des logs (LogEntry) côté Argos AI, indépendante de la
    // rétention Railway. Au-delà, les logs sont purgés définitivement (voir log-retention.job.ts).
    days: Number(process.env.LOG_RETENTION_DAYS ?? 7),
  },
  billing: {
    // Délai laissé après un premier échec de paiement (invoice.payment_failed) avant de
    // bloquer l'accès et d'arrêter le streaming de logs — voir billing-grace-period.job.ts.
    paymentGracePeriodDays: Number(process.env.PAYMENT_GRACE_PERIOD_DAYS ?? 3),
  },
};
