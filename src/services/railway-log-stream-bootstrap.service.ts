import { prisma } from "../lib/prisma";
import { startLogStreamForProject } from "./railway-log-stream.service";

export async function bootstrapRailwayLogStreams() {
  const projects = await prisma.project.findMany({
    where: {
      railwayProjectToken: { not: null },
      railwayServiceId: { not: null },
      railwayEnvironmentId: { not: null },
      archivedAt: null,
    },
  });

  for (const project of projects) {
    if (!project.railwayProjectToken || !project.railwayServiceId || !project.railwayEnvironmentId) continue;

    startLogStreamForProject({
      id: project.id,
      railwayProjectToken: project.railwayProjectToken,
      railwayServiceId: project.railwayServiceId,
      railwayEnvironmentId: project.railwayEnvironmentId,
    }).catch((err) => console.error(`Échec du redémarrage du streaming pour le projet ${project.id} :`, err));
  }

  if (projects.length > 0) {
    console.log(`Streaming Railway relancé pour ${projects.length} projet(s) déjà connecté(s).`);
  }
}
