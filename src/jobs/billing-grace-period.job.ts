import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { stopAllLogStreamsForSubscription } from "../services/billing/log-stream-control.service";

// Bloque l'accès et arrête le streaming de logs des abonnements en échec de paiement depuis
// plus de PAYMENT_GRACE_PERIOD_DAYS, sans attendre que Stripe abandonne de son côté (son
// calendrier de retries peut s'étaler sur 1 à 2 semaines) — évite de continuer à consommer
// des ressources (triage IA, SMS/email d'alerte) pour un compte en défaut de paiement
// persistant. Le déblocage se fait dans handleStripeWebhookEvent dès qu'un paiement réussit
// (invoice.paid), pas ici : ce job ne fait jamais que bloquer, jamais débloquer.
export async function blockOverduePaymentSubscriptions() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - env.billing.paymentGracePeriodDays);

  const overdueSubscriptions = await prisma.subscription.findMany({
    where: {
      status: "past_due",
      blockedAt: null,
      lastPaymentFailedAt: { lt: threshold },
    },
    select: { id: true, userId: true, organizationId: true },
  });

  for (const subscription of overdueSubscriptions) {
    await prisma.subscription.update({ where: { id: subscription.id }, data: { blockedAt: new Date() } });
    await stopAllLogStreamsForSubscription(subscription);
  }

  if (overdueSubscriptions.length > 0) {
    console.log(
      `Blocage pour paiement en retard : ${overdueSubscriptions.length} abonnement(s) bloqué(s) après ${env.billing.paymentGracePeriodDays} jour(s) de délai de grâce.`,
    );
  }

  return overdueSubscriptions.length;
}

// Programme la vérification quotidienne, à 4h du matin (heure serveur) — après la purge des
// logs (3h) pour ne jamais faire tourner les deux jobs en même temps.
export function scheduleBillingGracePeriodJob() {
  cron.schedule("0 4 * * *", () => {
    blockOverduePaymentSubscriptions().catch((err) => console.error("Échec du blocage des paiements en retard :", err));
  });

  console.log(`Blocage des paiements en retard planifié (délai de grâce : ${env.billing.paymentGracePeriodDays} jour(s), tous les jours à 4h).`);
}
