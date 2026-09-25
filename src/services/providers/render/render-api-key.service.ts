import { prisma } from "../../../lib/prisma";
import { encryptSecret, decryptSecret } from "../../../lib/encryption";
import { getMembershipForUser } from "../../organization/organization.service";

export class RenderApiKeyError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

// Une clé Render appartient à l'utilisateur seul, ou à son organisation si son compte en fait
// partie (partagée par tous les membres — même logique que Subscription/Project) : jamais les
// deux à la fois pour une même clé.
async function resolveScope(userId: string): Promise<{ userId: string; organizationId: null } | { userId: null; organizationId: string }> {
  const membership = await getMembershipForUser(userId);
  return membership ? { userId: null, organizationId: membership.organizationId } : { userId, organizationId: null };
}

export type RenderApiKeySummary = {
  id: string;
  label: string;
  lastFour: string;
  createdAt: Date;
};

export async function listRenderApiKeys(userId: string): Promise<RenderApiKeySummary[]> {
  const scope = await resolveScope(userId);

  return prisma.renderApiKey.findMany({
    where: scope,
    select: { id: true, label: true, lastFour: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createRenderApiKey(userId: string, params: { apiKey: string; label?: string }): Promise<RenderApiKeySummary> {
  const trimmed = params.apiKey.trim();
  if (!trimmed) {
    throw new RenderApiKeyError("La clé API est requise.", 400);
  }

  const scope = await resolveScope(userId);

  const created = await prisma.renderApiKey.create({
    data: {
      ...scope,
      label: params.label?.trim() || "Clé Render",
      encryptedKey: encryptSecret(trimmed),
      lastFour: trimmed.slice(-4),
    },
    select: { id: true, label: true, lastFour: true, createdAt: true },
  });

  return created;
}

// Renvoie la clé en clair, déchiffrée juste avant l'appel à l'API Render — jamais mise en
// cache, jamais renvoyée au frontend. Vérifie l'appartenance (userId/organizationId) avant de
// déchiffrer quoi que ce soit, pour qu'un utilisateur ne puisse jamais lire la clé d'un autre.
export async function getDecryptedRenderApiKey(userId: string, apiKeyId: string): Promise<string> {
  const scope = await resolveScope(userId);

  const record = await prisma.renderApiKey.findFirst({ where: { id: apiKeyId, ...scope } });
  if (!record) {
    throw new RenderApiKeyError("Clé API introuvable.", 404);
  }

  return decryptSecret(record.encryptedKey);
}

export async function deleteRenderApiKey(userId: string, apiKeyId: string): Promise<void> {
  const scope = await resolveScope(userId);

  const record = await prisma.renderApiKey.findFirst({
    where: { id: apiKeyId, ...scope },
    include: { projects: { select: { id: true, name: true } } },
  });

  if (!record) {
    throw new RenderApiKeyError("Clé API introuvable.", 404);
  }

  if (record.projects.length > 0) {
    const names = record.projects.map((p) => p.name).join(", ");
    throw new RenderApiKeyError(
      `Cette clé est utilisée par ${record.projects.length} projet(s) (${names}). Supprimez d'abord ces projets, ou déconnectez-les de Render.`,
      409,
    );
  }

  await prisma.renderApiKey.delete({ where: { id: apiKeyId } });
}
