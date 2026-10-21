import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../services/organization/organization.service", () => ({
  OrganizationError: class OrganizationError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  addMember: vi.fn(),
  getOrganizationOverview: vi.fn(),
  removeInvitation: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
}));

import { organizationRouter } from "./organization.route";
import {
  addMember,
  getOrganizationOverview,
  OrganizationError,
  removeInvitation,
  removeMember,
  updateMemberRole,
} from "../services/organization/organization.service";

beforeEach(() => {
  vi.mocked(addMember).mockReset();
  vi.mocked(getOrganizationOverview).mockReset();
  vi.mocked(removeInvitation).mockReset();
  vi.mocked(removeMember).mockReset();
  vi.mocked(updateMemberRole).mockReset();
});

describe("GET /api/organizations/me", () => {
  const handler = getRouteHandler(organizationRouter, "get", "/api/organizations/me");

  it("renvoie l'organisation formatée pour l'utilisateur courant", async () => {
    vi.mocked(getOrganizationOverview).mockResolvedValue({
      organization: {
        id: "org-1",
        name: "Ma société",
        createdAt: new Date("2026-01-01"),
        members: [{ role: "admin", createdAt: new Date("2026-01-01"), user: { id: "u-1", email: "a@b.com", firstName: "A", lastName: "B" } }],
        invitations: [{ id: "inv-1", email: "c@d.com", role: "user", createdAt: new Date("2026-01-01") }],
        projects: [],
      },
      myRole: "admin",
    } as never);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({
      organization: expect.objectContaining({
        id: "org-1",
        myRole: "admin",
        members: [expect.objectContaining({ userId: "u-1", role: "admin" })],
        invitations: [expect.objectContaining({ id: "inv-1" })],
      }),
    });
  });

  it("propage le code d'erreur d'une OrganizationError", async () => {
    vi.mocked(getOrganizationOverview).mockRejectedValue(new OrganizationError("Pas d'organisation.", 404));
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("POST /api/organizations/members", () => {
  const handler = getRouteHandler(organizationRouter, "post", "/api/organizations/members");

  it("ajoute un membre et répond 201", async () => {
    vi.mocked(addMember).mockResolvedValue({ invited: true } as never);
    const res = makeRes();

    await handler({ body: { email: "new@member.com" }, userId: "user-1" } as never, res);

    expect(addMember).toHaveBeenCalledWith({ adminUserId: "user-1", email: "new@member.com", role: "user" });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("propage le code d'erreur si l'appelant n'est pas admin", async () => {
    vi.mocked(addMember).mockRejectedValue(new OrganizationError("Accès refusé.", 403));
    const res = makeRes();

    await handler({ body: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("DELETE /api/organizations/members/:memberUserId", () => {
  const handler = getRouteHandler(organizationRouter, "delete", "/api/organizations/members/:memberUserId");

  it("retire le membre et répond 204", async () => {
    vi.mocked(removeMember).mockResolvedValue(undefined as never);
    const res = makeRes();

    await handler({ params: { memberUserId: "u-2" }, userId: "user-1" } as never, res);

    expect(removeMember).toHaveBeenCalledWith({ adminUserId: "user-1", memberUserId: "u-2" });
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe("PATCH /api/organizations/members/:memberUserId", () => {
  const handler = getRouteHandler(organizationRouter, "patch", "/api/organizations/members/:memberUserId");

  it("met à jour le rôle du membre", async () => {
    vi.mocked(updateMemberRole).mockResolvedValue({ role: "admin" } as never);
    const res = makeRes();

    await handler({ params: { memberUserId: "u-2" }, body: { role: "admin" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ membership: { role: "admin" } });
  });
});

describe("DELETE /api/organizations/invitations/:invitationId", () => {
  const handler = getRouteHandler(organizationRouter, "delete", "/api/organizations/invitations/:invitationId");

  it("annule l'invitation et répond 204", async () => {
    vi.mocked(removeInvitation).mockResolvedValue(undefined as never);
    const res = makeRes();

    await handler({ params: { invitationId: "inv-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(204);
  });
});
