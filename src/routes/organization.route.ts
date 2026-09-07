import { Router } from "express";
import {
  OrganizationError,
  addMember,
  getOrganizationOverview,
  removeInvitation,
  removeMember,
  updateMemberRole,
} from "../services/organization.service";

export const organizationRouter = Router();

function toPublicMember(membership: {
  role: string;
  createdAt: Date;
  user: { id: string; email: string; firstName: string; lastName: string };
}) {
  return {
    userId: membership.user.id,
    email: membership.user.email,
    firstName: membership.user.firstName,
    lastName: membership.user.lastName,
    role: membership.role,
    joinedAt: membership.createdAt,
  };
}

function toPublicInvitation(invitation: { id: string; email: string; role: string; createdAt: Date }) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: invitation.createdAt,
  };
}

organizationRouter.get("/api/organizations/me", async (req, res) => {
  try {
    const { organization, myRole } = await getOrganizationOverview(req.userId as string);

    res.json({
      organization: {
        id: organization.id,
        name: organization.name,
        createdAt: organization.createdAt,
        myRole,
        members: organization.members.map(toPublicMember),
        invitations: organization.invitations.map(toPublicInvitation),
        projects: organization.projects,
      },
    });
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la récupération de l'organisation :", err);
    res.status(500).json({ error: "Impossible de récupérer l'organisation." });
  }
});

organizationRouter.post("/api/organizations/members", async (req, res) => {
  try {
    const result = await addMember({
      adminUserId: req.userId as string,
      email: req.body?.email,
      role: req.body?.role ?? "user",
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de l'ajout d'un membre à l'organisation :", err);
    res.status(500).json({ error: "Impossible d'ajouter ce membre." });
  }
});

organizationRouter.delete("/api/organizations/members/:memberUserId", async (req, res) => {
  const { memberUserId } = req.params;

  try {
    await removeMember({ adminUserId: req.userId as string, memberUserId });
    res.status(204).end();
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors du retrait du membre ${memberUserId} :`, err);
    res.status(500).json({ error: "Impossible de retirer ce membre." });
  }
});

organizationRouter.patch("/api/organizations/members/:memberUserId", async (req, res) => {
  const { memberUserId } = req.params;

  try {
    const membership = await updateMemberRole({
      adminUserId: req.userId as string,
      memberUserId,
      role: req.body?.role,
    });
    res.json({ membership });
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors du changement de rôle du membre ${memberUserId} :`, err);
    res.status(500).json({ error: "Impossible de mettre à jour ce rôle." });
  }
});

organizationRouter.delete("/api/organizations/invitations/:invitationId", async (req, res) => {
  const { invitationId } = req.params;

  try {
    await removeInvitation({ adminUserId: req.userId as string, invitationId });
    res.status(204).end();
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de l'annulation de l'invitation ${invitationId} :`, err);
    res.status(500).json({ error: "Impossible d'annuler cette invitation." });
  }
});
