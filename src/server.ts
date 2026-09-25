import { createApp } from "./app";
import { env } from "./config/env";
import { bootstrapRailwayLogStreams } from "./services/providers/railway/railway-log-stream-bootstrap.service";
import { stopAllLogStreams as stopAllRailwayLogStreams } from "./services/providers/railway/railway-log-stream.service";
import { bootstrapRenderLogStreams } from "./services/providers/render/render-log-stream-bootstrap.service";
import { stopAllLogStreams as stopAllRenderLogStreams } from "./services/providers/render/render-log-stream.service";
import { scheduleLogRetentionJob } from "./jobs/log-retention.job";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Guardian AI backend listening on port ${env.port}`);
  bootstrapRailwayLogStreams().catch((err) => console.error("Échec du bootstrap du streaming Railway :", err));
  bootstrapRenderLogStreams().catch((err) => console.error("Échec du bootstrap du streaming Render :", err));
  scheduleLogRetentionJob();
});

function stopAllLogStreams() {
  stopAllRailwayLogStreams();
  stopAllRenderLogStreams();
}

process.on("SIGINT", () => {
  stopAllLogStreams();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAllLogStreams();
  process.exit(0);
});
