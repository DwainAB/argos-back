import { Router } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { PlanChangeError, downgradeToSoloPlan, getDowngradePreview, upgradeToBusinessPlan } from "../services/plan-change.service";
import { SubscriptionError, getSubscriptionForRequestingUser, previewPlanChange } from "../services/subscription.service";

const PLAN_CHANGE_RETURN_URL = `${env.frontendUrl}/dashboard/organizations/billing`;

export const planChangeRouter = Router();

// Montant exact (positif = à payer, négatif = crédit) qu'impliquerait le changement de
// plan demandé, sans rien facturer ni modifier — à afficher avant confirmation.
planChangeRouter.get("/api/subscription/preview-plan-change", async (req, res) => {
  const newPlan = req.query.plan;
  if (newPlan !== "solo" && newPlan !== "business") {
    return res.status(400).json({ error: "Paramètre plan invalide (attendu : solo ou business)." });
  }

  try {
    const subscription = await getSubscriptionForRequestingUser(req.userId as string);
    if (!subscription) {
      return res.status(404).json({ error: "Aucun abonnement trouvé." });
    }

    const preview = await previewPlanChange(subscription.id, newPlan);
    res.json(preview);
  } catch (err) {
    if (err instanceof SubscriptionError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors du calcul de l'aperçu de facturation :", err);
    res.status(500).json({ error: "Impossible de calculer le montant du changement de plan." });
  }
});

// Aperçu de ce qu'implique un downgrade Business → Solo pour l'organisation courante :
// bloqué si plusieurs membres, sinon la liste des projets actifs à choisir si elle dépasse
// la limite Solo. Appelé par le frontend avant d'afficher le bon écran (confirmation
// simple, sélection de projets, ou message de blocage).
planChangeRouter.get("/api/subscription/downgrade-preview", async (req, res) => {
  try {
    const membership = await prisma.organizationMembership.findUnique({ where: { userId: req.userId as string } });

    if (!membership) {
      return res.status(422).json({ error: "Vous n'appartenez à aucune organisation." });
    }

    const preview = await getDowngradePreview(membership.organizationId);
    res.json(preview);
  } catch (err) {
    console.error("Erreur lors du calcul de l'aperçu de downgrade :", err);
    res.status(500).json({ error: "Impossible de préparer le changement de plan." });
  }
});

planChangeRouter.post("/api/subscription/upgrade-to-business", async (req, res) => {
  try {
    const portalUrl = await upgradeToBusinessPlan({
      userId: req.userId as string,
      organizationName: req.body?.organizationName,
      returnUrl: PLAN_CHANGE_RETURN_URL,
    });

    res.json({ portalUrl });
  } catch (err) {
    if (err instanceof PlanChangeError || err instanceof SubscriptionError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors du passage au plan Business :", err);
    res.status(500).json({ error: "Impossible de passer au plan Business." });
  }
});

planChangeRouter.post("/api/subscription/downgrade-to-solo", async (req, res) => {
  try {
    const keepProjectIds = Array.isArray(req.body?.keepProjectIds) ? req.body.keepProjectIds : undefined;
    const portalUrl = await downgradeToSoloPlan({
      userId: req.userId as string,
      keepProjectIds,
      returnUrl: PLAN_CHANGE_RETURN_URL,
    });

    res.json({ portalUrl });
  } catch (err) {
    if (err instanceof PlanChangeError || err instanceof SubscriptionError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors du passage au plan Solo :", err);
    res.status(500).json({ error: "Impossible de passer au plan Solo." });
  }
});
