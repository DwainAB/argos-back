import { prisma } from "../../../lib/prisma";
import { decryptSecret } from "../../../lib/encryption";
import { startLogStreamForProject } from "./render-log-stream.service";

export async function bootstrapRenderLogStreams() {
  const projects = await prisma.project.findMany({
    where: {
      renderApiKeyId: { not: null },
      renderOwnerId: { not: null },
      renderResourceId: { not: null },
      archivedAt: null,
    },
    include: { renderApiKeyRef: true },
  });

  for (const project of projects) {
    if (!project.renderApiKeyRef || !project.renderOwnerId || !project.renderResourceId) continue;

    startLogStreamForProject({
      id: project.id,
      renderApiKey: decryptSecret(project.renderApiKeyRef.encryptedKey),
      renderOwnerId: project.renderOwnerId,
      renderResourceId: project.renderResourceId,
    }).catch((err) => console.error(`Échec du redémarrage du streaming pour le projet ${project.id} :`, err));
  }

  if (projects.length > 0) {
    console.log(`Streaming Render relancé pour ${projects.length} projet(s) déjà connecté(s).`);
  }
}
