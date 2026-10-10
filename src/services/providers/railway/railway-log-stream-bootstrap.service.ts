import { prisma } from "../../../lib/prisma";
import { startLogStreamForProject } from "./railway-log-stream.service";

export async function bootstrapRailwayLogStreams() {
  const projects = await prisma.project.findMany({
    where: {
      railwayProjectToken: { not: null },
      railwayServiceId: { not: null },
      railwayEnvironmentId: { not: null },
      archivedAt: null,
      // Ne relance jamais le streaming d'un projet dont l'abonnement est bloqué pour paiement
      // en retard persistant (voir billing-grace-period.job.ts) — sinon un simple redémarrage
      // du serveur contournerait le blocage. L'abonnement est porté par l'organisation si le
      // projet en a une, sinon par son propriétaire direct (userId) — jamais les deux à la fois.
      // `isNot` (pas un filtre imbriqué direct) pour qu'un projet dont le compte n'a encore
      // aucun abonnement (cas rare mais possible) ne soit jamais exclu à tort : Prisma exclut
      // un parent sans relation correspondante sur un filtre imbriqué direct, alors que
      // "pas d'abonnement" doit se comporter comme "non bloqué", pas comme "bloqué".
      OR: [
        { organizationId: { not: null }, organization: { subscription: { isNot: { blockedAt: { not: null } } } } },
        { organizationId: null, user: { subscription: { isNot: { blockedAt: { not: null } } } } },
      ],
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
