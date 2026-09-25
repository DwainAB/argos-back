import WebSocket from "ws";
import { processIncomingLog } from "../../logs/log-grouper.service";
import { persistGroupedLog } from "../../logs/log-ingestion.service";

const RENDER_WS_URL = "wss://api.render.com/v1/logs/subscribe";

type RenderLogLabel = { name: string; value: string };

type RenderLogMessage = {
  id: string;
  message: string;
  timestamp: string;
  labels: RenderLogLabel[];
};

function labelValue(labels: RenderLogLabel[], name: string): string | undefined {
  return labels.find((label) => label.name === name)?.value;
}

const activeSockets = new Map<string, WebSocket>();

export async function startLogStreamForProject(project: {
  id: string;
  renderApiKey: string;
  renderOwnerId: string;
  renderResourceId: string;
}) {
  stopLogStreamForProject(project.id);

  const url = new URL(RENDER_WS_URL);
  url.searchParams.set("ownerId", project.renderOwnerId);
  url.searchParams.set("resource", project.renderResourceId);
  url.searchParams.set("direction", "forward");

  const socket = new WebSocket(url.toString(), {
    headers: { Authorization: `Bearer ${project.renderApiKey}` },
  });

  socket.on("open", () => {
    console.log(`Streaming Render démarré pour le projet ${project.id}.`);
  });

  socket.on("message", (raw) => {
    let log: RenderLogMessage;
    try {
      log = JSON.parse(raw.toString());
    } catch (err) {
      console.error(`Streaming Render (projet ${project.id}) — message illisible :`, err);
      return;
    }

    const severity = labelValue(log.labels, "level") ?? "info";

    processIncomingLog(project.id, { timestamp: log.timestamp, message: log.message, severity }, (groupedLog) => {
      persistGroupedLog(project.id, "render", groupedLog).catch((err) =>
        console.error(`Erreur d'enregistrement d'un log (projet ${project.id}) :`, err)
      );
    });
  });

  socket.on("error", (err) => console.error(`Streaming Render (projet ${project.id}) — erreur :`, err));

  socket.on("close", () => {
    console.log(`Streaming Render (projet ${project.id}) — connexion fermée.`);
    activeSockets.delete(project.id);
  });

  activeSockets.set(project.id, socket);
}

export function stopLogStreamForProject(projectId: string) {
  const socket = activeSockets.get(projectId);
  if (socket) {
    socket.close();
    activeSockets.delete(projectId);
  }
}

export function stopAllLogStreams() {
  for (const projectId of activeSockets.keys()) {
    stopLogStreamForProject(projectId);
  }
}
