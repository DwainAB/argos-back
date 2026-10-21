import express, { Router } from "express";
import Stripe from "stripe";
import { env } from "../config/env";
import { handleStripeWebhookEvent } from "../services/billing/subscription.service";
import { logger } from "../lib/logger";

export const stripeWebhookRouter = Router();

const stripe = env.stripe.secretKey ? new Stripe(env.stripe.secretKey) : null;

// Monté avant express.json() dans app.ts : Stripe exige le corps brut (Buffer), non parsé,
// pour vérifier la signature de la requête.
stripeWebhookRouter.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];

  if (!stripe || !env.stripe.webhookSecret || typeof signature !== "string") {
    logger.error("Webhook Stripe reçu mais Stripe n'est pas configuré — ignoré.");
    return res.status(503).end();
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, env.stripe.webhookSecret);
  } catch (err) {
    logger.error({ err }, "Signature du webhook Stripe invalide :");
    return res.status(400).json({ error: "Signature invalide." });
  }

  try {
    await handleStripeWebhookEvent(event);
    res.status(200).end();
  } catch (err) {
    logger.error({ err }, `Erreur lors du traitement de l'événement Stripe ${event.type} :`);
    res.status(500).end();
  }
});
