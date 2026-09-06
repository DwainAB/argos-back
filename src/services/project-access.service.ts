import { prisma } from "../lib/prisma";

export function projectAccessFilter(userId: string) {
  return {
    OR: [{ userId }, { shares: { some: { sharedWithUserId: userId } } }],
  };
}

export async function listProjectRecipients(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: { select: { email: true } }, shares: { select: { email: true } } },
  });

  if (!project) return [];

  const emails = new Set<string>([project.user.email, ...project.shares.map((share) => share.email)]);
  return [...emails];
}
