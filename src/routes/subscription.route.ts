import { Router } from "express";
import {
  QUOTAS,
  SubscriptionError,
  createBillingPortalSession,
  createCheckoutSession,
  getSubscriptionForRequestingUser,
} from "../services/subscription.service";

export const subscriptionRouter = Router();

subscriptionRouter.get("/api/subscription/me", async (req, res) => {
  try {
    const subscription = await getSubscriptionForRequestingUser(req.userId as string);

    if (!subscription) {
      return res.status(404).json({ error: "Aucun abonnement trouvé." });
    }

    const quotas = QUOTAS[subscription.plan as "solo" | "business"] ?? QUOTAS.solo;

    res.json({
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        sms: { used: subscription.smsUsedThisPeriod, limit: quotas.sms },
        fixes: { used: subscription.fixesUsedThisPeriod, limit: quotas.fixes },
      },
    });
  } catch (err) {
    console.error("Erreur lors de la récupération de l'abonnement :", err);
    res.status(500).json({ error: "Impossible de récupérer l'abonnement." });
  }
});

subscriptionRouter.post("/api/subscription/checkout", async (req, res) => {
  try {
    const subscription = await getSubscriptionForRequestingUser(req.userId as string);

    if (!subscription) {
      return res.status(404).json({ error: "Aucun abonnement trouvé." });
    }

    const url = await createCheckoutSession(subscription.id);
    res.json({ url });
  } catch (err) {
    if (err instanceof SubscriptionError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la création de la session de paiement :", err);
    res.status(500).json({ error: "Impossible de créer la session de paiement." });
  }
});

subscriptionRouter.post("/api/subscription/portal", async (req, res) => {
  try {
    const subscription = await getSubscriptionForRequestingUser(req.userId as string);

    if (!subscription) {
      return res.status(404).json({ error: "Aucun abonnement trouvé." });
    }

    const url = await createBillingPortalSession(subscription.id);
    res.json({ url });
  } catch (err) {
    if (err instanceof SubscriptionError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la création de la session du portail de facturation :", err);
    res.status(500).json({ error: "Impossible d'ouvrir le portail de facturation." });
  }
});
