import { createApp } from "./app";
import { env } from "./config/env";
import { bootstrapRailwayLogStreams } from "./services/providers/railway/railway-log-stream-bootstrap.service";
import { stopAllLogStreams as stopAllRailwayLogStreams } from "./services/providers/railway/railway-log-stream.service";
import { bootstrapRenderLogStreams } from "./services/providers/render/render-log-stream-bootstrap.service";
import { stopAllLogStreams as stopAllRenderLogStreams } from "./services/providers/render/render-log-stream.service";
import { scheduleLogRetentionJob } from "./jobs/log-retention.job";
import { scheduleBillingGracePeriodJob } from "./jobs/billing-grace-period.job";
import { logger } from "./lib/logger";

// Point d'entrée : crée l'application, ouvre le port et lance les tâches de fond.
const app = createApp();

app.listen(env.port, () => {
  logger.info(`Argos AI backend listening on port ${env.port}`);

  // Rouvre les flux de logs des projets actifs (coupés par le redémarrage), sans faire planter l'API.
  bootstrapRailwayLogStreams().catch((err) => logger.error({ err }, "Échec du bootstrap du streaming Railway :"));
  bootstrapRenderLogStreams().catch((err) => logger.error({ err }, "Échec du bootstrap du streaming Render :"));

  // Tâches planifiées : purge des vieux logs, blocage après le délai de grâce de paiement.
  scheduleLogRetentionJob();
  scheduleBillingGracePeriodJob();
});

// Ferme proprement les connexions Railway/Render avant l'arrêt.
function stopAllLogStreams() {
  stopAllRailwayLogStreams();
  stopAllRenderLogStreams();
}

// SIGINT : Ctrl+C en local. SIGTERM : arrêt par Railway lors d'un déploiement.
process.on("SIGINT", () => {
  stopAllLogStreams();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAllLogStreams();
  process.exit(0);
});
