import { createApp } from "./app";
import { env } from "./config/env";
import { bootstrapRailwayLogStreams } from "./services/railway-log-stream-bootstrap.service";
import { stopAllLogStreams } from "./services/railway-log-stream.service";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Argos AI backend listening on port ${env.port}`);
  bootstrapRailwayLogStreams().catch((err) => console.error("Échec du bootstrap du streaming Railway :", err));
});

// Ferme proprement les connexions WebSocket ouvertes lors de l'arrêt du serveur.
process.on("SIGINT", () => {
  stopAllLogStreams();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAllLogStreams();
  process.exit(0);
});
