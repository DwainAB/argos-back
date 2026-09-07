import { prisma } from "../lib/prisma";
import { sendOrganizationAddedEmail, sendOrganizationInvitationEmail } from "./email.service";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class OrganizationError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

function assertValidEmail(email: unknown): asserts email is string {
  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    throw new OrganizationError("Adresse email invalide.", 400);
  }
}

function assertValidRole(role: unknown): asserts role is "admin" | "user" {
  if (role !== "admin" && role !== "user") {
    throw new OrganizationError("Rôle invalide.", 400);
  }
}

export async function getMembershipForUser(userId: string) {
  return prisma.organizationMembership.findUnique({ where: { userId } });
}

// Un simple membre ("user") ne gère que les logs/alertes ; toute action qui modifie la
// configuration d'un projet d'organisation (renommer, connecter un dépôt/service, créer,
// supprimer) est réservée à un administrateur de cette organisation.
export async function assertCanManageProject(userId: string, project: { organizationId: string | null }) {
  if (!project.organizationId) return;

  const membership = await prisma.organizationMembership.findUnique({ where: { userId } });

  if (membership?.role !== "admin") {
    throw new OrganizationError("Seul un administrateur de l'organisation peut gérer ce projet.", 403);
  }
}

async function requireAdminMembership(userId: string) {
  const membership = await prisma.organizationMembership.findUnique({ where: { userId } });

  if (!membership) {
    throw new OrganizationError("Vous n'appartenez à aucune organisation.", 403);
  }

  if (membership.role !== "admin") {
    throw new OrganizationError("Seul un administrateur de l'organisation peut effectuer cette action.", 403);
  }

  return membership;
}

async function requireMembership(userId: string) {
  const membership = await prisma.organizationMembership.findUnique({ where: { userId } });

  if (!membership) {
    throw new OrganizationError("Vous n'appartenez à aucune organisation.", 403);
  }

  return membership;
}

export async function getOrganizationOverview(userId: string) {
  const membership = await requireMembership(userId);

  const organization = await prisma.organization.findUnique({
    where: { id: membership.organizationId },
    include: {
      members: { include: { user: true }, orderBy: { createdAt: "asc" } },
      invitations: { orderBy: { createdAt: "asc" } },
      projects: { select: { id: true, name: true, createdAt: true } },
    },
  });

  if (!organization) {
    throw new OrganizationError("Organisation introuvable.", 404);
  }

  return { organization, myRole: membership.role };
}

export async function addMember(input: { adminUserId: string; email: unknown; role: unknown }) {
  const { adminUserId, email, role } = input;

  assertValidEmail(email);
  assertValidRole(role);

  const adminMembership = await requireAdminMembership(adminUserId);
  const normalizedEmail = email.trim().toLowerCase();

  const organization = await prisma.organization.findUnique({ where: { id: adminMembership.organizationId } });
  if (!organization) {
    throw new OrganizationError("Organisation introuvable.", 404);
  }

  const targetUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (targetUser) {
    const existingMembership = await prisma.organizationMembership.findUnique({ where: { userId: targetUser.id } });
    if (existingMembership) {
      throw new OrganizationError("Cette personne appartient déjà à une organisation.", 409);
    }

    const membership = await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: targetUser.id, role },
    });

    sendOrganizationAddedEmail({
      to: normalizedEmail,
      firstName: targetUser.firstName,
      organizationName: organization.name,
    }).catch((err) => console.error(`Erreur lors de l'envoi de l'email d'ajout à l'organisation à ${normalizedEmail} :`, err));

    return { type: "member" as const, membership };
  }

  let invitation;
  try {
    invitation = await prisma.organizationInvitation.create({
      data: { organizationId: organization.id, email: normalizedEmail, role },
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      throw new OrganizationError("Cette adresse email a déjà été invitée.", 409);
    }
    throw err;
  }

  sendOrganizationInvitationEmail({
    to: normalizedEmail,
    organizationName: organization.name,
  }).catch((err) => console.error(`Erreur lors de l'envoi de l'email d'invitation à ${normalizedEmail} :`, err));

  return { type: "invitation" as const, invitation };
}

export async function removeMember(input: { adminUserId: string; memberUserId: string }) {
  const { adminUserId, memberUserId } = input;

  const adminMembership = await requireAdminMembership(adminUserId);

  const targetMembership = await prisma.organizationMembership.findFirst({
    where: { userId: memberUserId, organizationId: adminMembership.organizationId },
  });

  if (!targetMembership) {
    throw new OrganizationError("Membre introuvable.", 404);
  }

  if (targetMembership.userId === adminUserId) {
    throw new OrganizationError("Vous ne pouvez pas vous retirer vous-même de l'organisation.", 422);
  }

  await prisma.organizationMembership.delete({ where: { id: targetMembership.id } });
}

export async function removeInvitation(input: { adminUserId: string; invitationId: string }) {
  const { adminUserId, invitationId } = input;

  const adminMembership = await requireAdminMembership(adminUserId);

  const invitation = await prisma.organizationInvitation.findFirst({
    where: { id: invitationId, organizationId: adminMembership.organizationId },
  });

  if (!invitation) {
    throw new OrganizationError("Invitation introuvable.", 404);
  }

  await prisma.organizationInvitation.delete({ where: { id: invitation.id } });
}

export async function updateMemberRole(input: { adminUserId: string; memberUserId: string; role: unknown }) {
  const { adminUserId, memberUserId, role } = input;

  assertValidRole(role);
  const adminMembership = await requireAdminMembership(adminUserId);

  const targetMembership = await prisma.organizationMembership.findFirst({
    where: { userId: memberUserId, organizationId: adminMembership.organizationId },
  });

  if (!targetMembership) {
    throw new OrganizationError("Membre introuvable.", 404);
  }

  if (targetMembership.userId === adminUserId && role !== "admin") {
    throw new OrganizationError("Vous ne pouvez pas retirer votre propre rôle d'administrateur.", 422);
  }

  return prisma.organizationMembership.update({
    where: { id: targetMembership.id },
    data: { role },
  });
}
