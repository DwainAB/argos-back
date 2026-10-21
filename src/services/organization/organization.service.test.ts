import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../notifications/email.service", () => ({
  sendOrganizationAddedEmail: vi.fn(),
  sendOrganizationInvitationEmail: vi.fn(),
}));

import {
  addMember,
  assertCanManageProject,
  getMembershipForUser,
  getOrganizationOverview,
  OrganizationError,
  removeInvitation,
  removeMember,
  updateMemberRole,
} from "./organization.service";
import { sendOrganizationAddedEmail, sendOrganizationInvitationEmail } from "../notifications/email.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(sendOrganizationAddedEmail).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(sendOrganizationInvitationEmail).mockReset().mockResolvedValue(undefined as never);
});

describe("getMembershipForUser", () => {
  it("renvoie l'adhésion de l'utilisateur", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ role: "admin" } as never);
    await expect(getMembershipForUser("user-1")).resolves.toEqual({ role: "admin" });
  });
});

describe("assertCanManageProject", () => {
  it("ne lève rien pour un projet personnel (sans organisation)", async () => {
    await expect(assertCanManageProject("user-1", { organizationId: null })).resolves.toBeUndefined();
    expect(prismaMock.organizationMembership.findUnique).not.toHaveBeenCalled();
  });

  it("lève une erreur si l'utilisateur n'est pas admin de l'organisation du projet", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ role: "user" } as never);

    await expect(assertCanManageProject("user-1", { organizationId: "org-1" })).rejects.toThrow(
      "Seul un administrateur",
    );
  });

  it("ne lève rien si l'utilisateur est admin de l'organisation du projet", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ role: "admin" } as never);

    await expect(assertCanManageProject("user-1", { organizationId: "org-1" })).resolves.toBeUndefined();
  });
});

describe("getOrganizationOverview", () => {
  it("lève une erreur si l'utilisateur n'appartient à aucune organisation", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);

    await expect(getOrganizationOverview("user-1")).rejects.toThrow("n'appartenez à aucune organisation");
  });

  it("lève une erreur 404 si l'organisation n'existe plus", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organization.findUnique.mockResolvedValue(null);

    await expect(getOrganizationOverview("user-1")).rejects.toThrow("Organisation introuvable");
  });

  it("renvoie l'organisation et le rôle du demandeur", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organization.findUnique.mockResolvedValue({ id: "org-1", name: "Ma société" } as never);

    await expect(getOrganizationOverview("user-1")).resolves.toEqual({
      organization: { id: "org-1", name: "Ma société" },
      myRole: "admin",
    });
  });
});

describe("addMember", () => {
  it("rejette une adresse email invalide", async () => {
    await expect(addMember({ adminUserId: "u-1", email: "pas-un-email", role: "user" })).rejects.toThrow(
      "Adresse email invalide",
    );
  });

  it("rejette un rôle invalide", async () => {
    await expect(addMember({ adminUserId: "u-1", email: "x@y.com", role: "superadmin" })).rejects.toThrow(
      "Rôle invalide",
    );
  });

  it("rejette si l'appelant n'est pas administrateur", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ role: "user" } as never);

    await expect(addMember({ adminUserId: "u-1", email: "x@y.com", role: "user" })).rejects.toThrow(
      "Seul un administrateur",
    );
  });

  it("ajoute directement un utilisateur existant comme membre", async () => {
    prismaMock.organizationMembership.findUnique
      .mockResolvedValueOnce({ organizationId: "org-1", role: "admin" } as never) // requireAdminMembership
      .mockResolvedValueOnce(null); // existingMembership du targetUser
    prismaMock.organization.findUnique.mockResolvedValue({ id: "org-1", name: "Ma société" } as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-2", firstName: "Jean" } as never);
    prismaMock.organizationMembership.create.mockResolvedValue({ id: "mem-1" } as never);

    const result = await addMember({ adminUserId: "u-1", email: "X@Y.com", role: "user" });

    expect(result).toEqual({ type: "member", membership: { id: "mem-1" } });
    expect(sendOrganizationAddedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "x@y.com", organizationName: "Ma société" }),
    );
  });

  it("rejette si l'utilisateur ciblé appartient déjà à une organisation", async () => {
    prismaMock.organizationMembership.findUnique
      .mockResolvedValueOnce({ organizationId: "org-1", role: "admin" } as never)
      .mockResolvedValueOnce({ id: "mem-existing" } as never);
    prismaMock.organization.findUnique.mockResolvedValue({ id: "org-1", name: "Ma société" } as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-2" } as never);

    await expect(addMember({ adminUserId: "u-1", email: "x@y.com", role: "user" })).rejects.toThrow(
      "appartient déjà à une organisation",
    );
  });

  it("crée une invitation si l'utilisateur n'existe pas encore", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organization.findUnique.mockResolvedValue({ id: "org-1", name: "Ma société" } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.organizationInvitation.create.mockResolvedValue({ id: "inv-1" } as never);

    const result = await addMember({ adminUserId: "u-1", email: "nouveau@y.com", role: "user" });

    expect(result).toEqual({ type: "invitation", invitation: { id: "inv-1" } });
    expect(sendOrganizationInvitationEmail).toHaveBeenCalled();
  });

  it("rejette si l'adresse a déjà été invitée (contrainte unique P2002)", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organization.findUnique.mockResolvedValue({ id: "org-1", name: "Ma société" } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.organizationInvitation.create.mockRejectedValue({ code: "P2002" });

    await expect(addMember({ adminUserId: "u-1", email: "deja@invite.com", role: "user" })).rejects.toThrow(
      "déjà été invitée",
    );
  });
});

describe("removeMember", () => {
  it("rejette si le membre ciblé n'existe pas dans l'organisation", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue(null);

    await expect(removeMember({ adminUserId: "u-1", memberUserId: "u-2" })).rejects.toThrow("Membre introuvable");
  });

  it("rejette si l'admin tente de se retirer lui-même", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue({ id: "mem-1", userId: "u-1" } as never);

    await expect(removeMember({ adminUserId: "u-1", memberUserId: "u-1" })).rejects.toThrow(
      "ne pouvez pas vous retirer vous-même",
    );
  });

  it("retire le membre ciblé", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue({ id: "mem-2", userId: "u-2" } as never);
    prismaMock.organizationMembership.delete.mockResolvedValue({} as never);

    await removeMember({ adminUserId: "u-1", memberUserId: "u-2" });

    expect(prismaMock.organizationMembership.delete).toHaveBeenCalledWith({ where: { id: "mem-2" } });
  });
});

describe("removeInvitation", () => {
  it("rejette si l'invitation n'existe pas", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationInvitation.findFirst.mockResolvedValue(null);

    await expect(removeInvitation({ adminUserId: "u-1", invitationId: "inv-1" })).rejects.toThrow(
      "Invitation introuvable",
    );
  });

  it("supprime l'invitation", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationInvitation.findFirst.mockResolvedValue({ id: "inv-1" } as never);
    prismaMock.organizationInvitation.delete.mockResolvedValue({} as never);

    await removeInvitation({ adminUserId: "u-1", invitationId: "inv-1" });

    expect(prismaMock.organizationInvitation.delete).toHaveBeenCalledWith({ where: { id: "inv-1" } });
  });
});

describe("updateMemberRole", () => {
  it("rejette un rôle invalide", async () => {
    await expect(updateMemberRole({ adminUserId: "u-1", memberUserId: "u-2", role: "superadmin" })).rejects.toThrow(
      "Rôle invalide",
    );
  });

  it("rejette si l'admin tente de retirer son propre rôle d'administrateur", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue({ id: "mem-1", userId: "u-1" } as never);

    await expect(updateMemberRole({ adminUserId: "u-1", memberUserId: "u-1", role: "user" })).rejects.toThrow(
      "retirer votre propre rôle",
    );
  });

  it("met à jour le rôle d'un autre membre", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue({ id: "mem-2", userId: "u-2" } as never);
    prismaMock.organizationMembership.update.mockResolvedValue({ id: "mem-2", role: "admin" } as never);

    const result = await updateMemberRole({ adminUserId: "u-1", memberUserId: "u-2", role: "admin" });

    expect(result).toEqual({ id: "mem-2", role: "admin" });
  });
});
