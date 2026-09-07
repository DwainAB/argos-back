import { prisma } from "../lib/prisma";

export async function projectAccessFilter(userId: string) {
  const membership = await prisma.organizationMembership.findUnique({ where: { userId } });

  return {
    OR: [
      { userId },
      { shares: { some: { sharedWithUserId: userId } } },
      ...(membership ? [{ organizationId: membership.organizationId }] : []),
    ],
  };
}

export async function listProjectRecipients(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      user: { select: { email: true } },
      shares: { select: { email: true } },
      organization: { include: { members: { include: { user: { select: { email: true } } } } } },
    },
  });

  if (!project) return [];

  const emails = new Set<string>([project.user.email, ...project.shares.map((share) => share.email)]);
  for (const member of project.organization?.members ?? []) {
    emails.add(member.user.email);
  }
  return [...emails];
}
