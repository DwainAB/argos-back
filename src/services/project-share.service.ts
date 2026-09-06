import { prisma } from "../lib/prisma";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ProjectShareError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

function assertValidEmail(email: unknown): asserts email is string {
  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    throw new ProjectShareError("Adresse email invalide.", 400);
  }
}

// Vérifie que le projet appartient bien au compte demandeur et que ce compte est de type
// "organization" — un compte personnel ne peut pas partager de projet. Renvoie le projet
// si tout est en ordre.
async function assertCanShare(projectId: string, ownerUserId: string) {
  const [project, owner] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, userId: ownerUserId } }),
    prisma.user.findUnique({ where: { id: ownerUserId } }),
  ]);

  if (!project) {
    throw new ProjectShareError("Projet introuvable.", 404);
  }

  if (owner?.accountType !== "organization") {
    throw new ProjectShareError("Seul un compte organisation peut partager un projet.", 403);
  }

  return project;
}

// Partage un projet avec un email. Si un compte personnel existe déjà pour cet email,
// l'accès est actif immédiatement ; sinon il reste en attente et s'active automatiquement
// à l'inscription (voir auth.service.ts::signup).
export async function shareProject(input: { projectId: string; ownerUserId: string; email: unknown }) {
  const { projectId, ownerUserId, email } = input;

  assertValidEmail(email);
  await assertCanShare(projectId, ownerUserId);

  const normalizedEmail = email.trim().toLowerCase();

  const targetUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (targetUser?.accountType === "organization") {
    throw new ProjectShareError("Impossible de partager un projet avec un compte organisation.", 422);
  }

  try {
    return await prisma.projectShare.create({
      data: {
        projectId,
        email: normalizedEmail,
        sharedWithUserId: targetUser?.id ?? null,
      },
    });
  } catch (err) {
    // Contrainte unique [projectId, email] : déjà partagé avec cet email.
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      throw new ProjectShareError("Ce projet est déjà partagé avec cet email.", 409);
    }
    throw err;
  }
}

export async function unshareProject(input: { projectId: string; ownerUserId: string; shareId: string }) {
  const { projectId, ownerUserId, shareId } = input;

  await assertCanShare(projectId, ownerUserId);

  const share = await prisma.projectShare.findFirst({ where: { id: shareId, projectId } });

  if (!share) {
    throw new ProjectShareError("Partage introuvable.", 404);
  }

  await prisma.projectShare.delete({ where: { id: shareId } });
}

export async function listShares(projectId: string, ownerUserId: string) {
  await assertCanShare(projectId, ownerUserId);

  return prisma.projectShare.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
}
