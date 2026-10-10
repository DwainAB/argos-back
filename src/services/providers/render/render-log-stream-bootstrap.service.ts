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
