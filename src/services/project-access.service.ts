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

// Numéros de téléphone des personnes à notifier par SMS pour ce projet : le propriétaire,
// les comptes personnels destinataires d'un partage, et les membres de l'organisation
// propriétaire. Une personne sans numéro renseigné est silencieusement ignorée (le SMS est
// un canal en plus de l'email, jamais bloquant).
export async function listProjectPhoneRecipients(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      user: { select: { phone: true } },
      shares: { include: { sharedWithUser: { select: { phone: true } } } },
      organization: { include: { members: { include: { user: { select: { phone: true } } } } } },
    },
  });

  if (!project) return [];

  const phones = new Set<string>();
  if (project.user.phone) phones.add(project.user.phone);
  for (const share of project.shares) {
    if (share.sharedWithUser?.phone) phones.add(share.sharedWithUser.phone);
  }
  for (const member of project.organization?.members ?? []) {
    if (member.user.phone) phones.add(member.user.phone);
  }
  return [...phones];
}
