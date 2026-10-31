# Argos AI — Backend

REST API of **Argos AI**, a SaaS that connects a user's code repositories (GitHub, GitLab) and hosting services (Railway, Render), collects their production logs in real time, and uses AI to detect errors, explain them in plain language and notify the right people by email or SMS.

- Live app: https://www.ai-argos.com
- API documentation (Swagger): https://argos-back-production-4ec1.up.railway.app/api-docs
- Frontend repository: https://github.com/DwainAB/argos-front

## Features

- **Log collection** — real-time log streaming from Railway (GraphQL subscriptions over `graphql-ws`) and Render, with configurable retention.
- **AI triage** — logs are classified (error / warning / info), grouped by root cause and explained in plain language. Triage runs on Groq (OpenAI-compatible API); deeper analyses run on OpenAI.
- **Secret detection** — secrets leaked in logs are detected (pattern matching + AI) and masked before storage.
- **Alerts & notifications** — alerts per project, sent by email (Resend) and SMS (SMSFactor).
- **Code analysis** — full repository review (security, performance, architecture) and fix suggestions, with pull/merge request creation on GitHub and GitLab.
- **Integrations** — GitHub App (installation-based access), GitLab OAuth, Railway OAuth, Render API keys (encrypted at rest with AES-256-GCM).
- **Accounts & organizations** — personal and organization accounts, members, roles, invitations and project sharing.
- **Billing** — Stripe subscriptions (Solo / Business), webhooks, usage limits and payment grace period.
- **Authentication** — delegated to [Clerk](https://clerk.com) (email/password, Google, GitHub, GitLab, MFA). The API only verifies Clerk session tokens and keeps the business data (account type, organization, subscription).

## Tech stack

| Area | Technology |
|---|---|
| Runtime | Node.js 24, TypeScript |
| Framework | Express 4 |
| Database | MySQL with Prisma ORM |
| Authentication | Clerk (`@clerk/express`) |
| AI | Groq and OpenAI (via the `openai` SDK) |
| Integrations | Octokit (GitHub App), GitLab / Railway / Render APIs |
| Real time | `graphql-ws`, `ws` |
| Scheduled jobs | `node-cron` |
| Payments | Stripe |
| Notifications | Resend (email), SMSFactor (SMS) |
| Logging | Pino |
| Tests | Vitest |
| API docs | OpenAPI 3 + Swagger UI |

## Architecture

```
src/
├── app.ts               # Express app: middlewares and route mounting
├── server.ts            # Entry point: HTTP server, log streams, cron jobs
├── config/env.ts        # Typed access to environment variables
├── middlewares/         # Clerk authentication, 404 handler
├── routes/              # HTTP routes (one file per resource) + webhooks (Stripe, Clerk)
├── services/
│   ├── auth/            # Onboarding, account linking with Clerk
│   ├── logs/            # Ingestion, classification, grouping, AI triage, secret masking
│   ├── code-analysis/   # Repository analysis and fix suggestions
│   ├── providers/       # GitHub, GitLab, Railway, Render clients
│   ├── notifications/   # Email and SMS
│   ├── billing/         # Subscriptions, plan changes, usage limits
│   ├── organization/    # Members, roles, project access and sharing
│   └── activity/        # Activity log
├── jobs/                # Log retention, payment grace period
└── lib/                 # Prisma client, encryption, logger
prisma/                  # Schema and migrations
openapi.yaml             # API specification served at /api-docs
```

### Authentication flow

1. The frontend signs the user in with Clerk and sends the session token in the `Authorization: Bearer` header.
2. `clerkMiddleware()` validates the token on every request.
3. `authMiddleware` maps the Clerk user to the Argos AI account (`User.clerkId`). Accounts created before the move to Clerk are linked automatically on first sign-in, using the verified primary email.
4. A signed-in user without an Argos AI account gets `403 ONBOARDING_REQUIRED` until `POST /api/auth/onboarding` (account type, organization) is completed.

## Getting started

### Prerequisites

- Node.js 24
- A MySQL database (**use a local or test database, never the production one**)
- A Clerk application (development instance)

### Installation

```bash
npm install
cp .env.example .env      # then fill in the values
npm run prisma:migrate    # applies migrations to the database in DATABASE_URL
npm run dev               # http://localhost:4000
```

### Environment variables

All variables are documented in [`.env.example`](.env.example). The main ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `FRONTEND_URL` | Frontend origin (CORS, redirects) |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk authentication |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk webhook (`user.updated`) |
| `ENCRYPTION_KEY` | 32-byte key used to encrypt third-party secrets at rest |
| `GITHUB_APP_*` | GitHub App credentials |
| `GITLAB_APP_*` | GitLab OAuth application |
| `RAILWAY_OAUTH_*` | Railway OAuth application |
| `GROQ_API_KEY`, `OPENAI_API_KEY` | AI providers |
| `RESEND_API_KEY`, `SMSFACTOR_API_TOKEN` | Email and SMS |
| `STRIPE_*` | Payments |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled API |
| `npm test` | Run the test suite |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run prisma:migrate` | Create/apply migrations (development) |
| `npm run prisma:generate` | Regenerate the Prisma client |

## Tests and CI

Unit tests use Vitest, with Prisma and external services mocked. GitHub Actions runs on every pull request and push to `main`: install, Prisma client generation, tests and build.

## Deployment

The API is deployed on Railway from the `main` branch. Database migrations are applied with `npx prisma migrate deploy`.

## Contributing

- Work on a dedicated branch (`feature/…`, `fix/…`, `docs/…`); `main` only changes through pull requests.
- Code comments and commit messages are written in French; code and technical documentation in English.
