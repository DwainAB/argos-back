import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

// Purge les LogEntry plus vieux que le seuil de rétention configuré (LOG_RETENTION_DAYS,
// 7 jours par défaut). La suppression d'un LogEntry entraîne, par cascade Prisma, la
// suppression de son Alert associée (voir schema.prisma) : aucune règle à part pour les
// alertes, elles suivent la même rétention que les logs normaux.
export async function purgeOldLogs() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - env.logRetention.days);

  const { count } = await prisma.logEntry.deleteMany({
    where: { createdAt: { lt: threshold } },
  });

  if (count > 0) {
    console.log(`Purge des logs : ${count} entrée(s) de plus de ${env.logRetention.days} jour(s) supprimée(s).`);
  }

  return count;
}

// Programme la purge quotidienne, à 3h du matin (heure serveur).
export function scheduleLogRetentionJob() {
  cron.schedule("0 3 * * *", () => {
    purgeOldLogs().catch((err) => console.error("Échec de la purge des logs :", err));
  });

  console.log(`Purge des logs planifiée (rétention : ${env.logRetention.days} jour(s), tous les jours à 3h).`);
}
