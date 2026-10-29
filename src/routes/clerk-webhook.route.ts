import express, { Router } from "express";
import { verifyWebhook, type WebhookEvent } from "@clerk/express/webhooks";
import { env } from "../config/env";
import { syncClerkUserEmail } from "../services/auth/auth.service";
import { logger } from "../lib/logger";

export const clerkWebhookRouter = Router();

// Monté avant express.json() dans app.ts, comme le webhook Stripe : la signature Svix porte
// sur le corps brut, un JSON re-sérialisé pourrait ne plus correspondre octet pour octet.
clerkWebhookRouter.post("/api/webhooks/clerk", express.raw({ type: "application/json" }), async (req, res) => {
  if (!env.clerk.webhookSigningSecret) {
    logger.error("Webhook Clerk reçu mais CLERK_WEBHOOK_SIGNING_SECRET n'est pas configuré — ignoré.");
    return res.status(503).end();
  }

  let event: WebhookEvent;
  try {
    event = await verifyWebhook(req, { signingSecret: env.clerk.webhookSigningSecret });
  } catch (err) {
    logger.error({ err }, "Signature du webhook Clerk invalide :");
    return res.status(400).json({ error: "Signature invalide." });
  }

  try {
    if (event.type === "user.updated") {
      const primaryEmail = event.data.email_addresses.find((address) => address.id === event.data.primary_email_address_id);
      if (primaryEmail) {
        await syncClerkUserEmail(event.data.id, primaryEmail.email_address);
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, `Erreur lors du traitement du webhook Clerk (${event.type}) :`);
    res.status(500).json({ error: "Erreur lors du traitement du webhook." });
  }
});
