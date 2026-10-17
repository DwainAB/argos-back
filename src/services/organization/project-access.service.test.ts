import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));

import {
  listProjectPhoneRecipients,
  listProjectRecipients,
  projectAccessFilter,
} from "./project-access.service";

beforeEach(() => {
  resetPrismaMock();
});

describe("projectAccessFilter", () => {
  it("filtre sur le propriétaire et les partages quand l'utilisateur n'a pas d'organisation", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);

    const filter = await projectAccessFilter("user-1");

    expect(filter).toEqual({
      archivedAt: null,
      OR: [{ userId: "user-1" }, { shares: { some: { sharedWithUserId: "user-1" } } }],
    });
  });

  it("inclut les projets de l'organisation quand l'utilisateur en est membre", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({
      id: "mem-1",
      userId: "user-1",
      organizationId: "org-1",
      role: "user",
      createdAt: new Date(),
    } as never);

    const filter = await projectAccessFilter("user-1");

    expect(filter.OR).toContainEqual({ organizationId: "org-1" });
  });

  it("exclut toujours les projets archivés", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);

    const filter = await projectAccessFilter("user-1");

    expect(filter.archivedAt).toBeNull();
  });
});

describe("listProjectRecipients", () => {
  it("retourne un tableau vide si le projet n'existe pas", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);

    expect(await listProjectRecipients("missing-project")).toEqual([]);
  });

  it("agrège l'email du propriétaire, des partages et des membres de l'organisation sans doublon", async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      user: { email: "owner@example.com" },
      shares: [{ email: "owner@example.com" }, { email: "shared@example.com" }],
      organization: {
        members: [
          { user: { email: "member1@example.com" } },
          { user: { email: "owner@example.com" } },
        ],
      },
    } as never);

    const recipients = await listProjectRecipients("proj-1");

    expect(recipients.sort()).toEqual(
      ["owner@example.com", "shared@example.com", "member1@example.com"].sort()
    );
  });

  it("fonctionne sans organisation propriétaire", async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      user: { email: "owner@example.com" },
      shares: [],
      organization: null,
    } as never);

    expect(await listProjectRecipients("proj-1")).toEqual(["owner@example.com"]);
  });
});

describe("listProjectPhoneRecipients", () => {
  it("retourne un tableau vide si le projet n'existe pas", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);

    expect(await listProjectPhoneRecipients("missing-project")).toEqual([]);
  });

  it("ignore silencieusement les personnes sans numéro de téléphone renseigné", async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      user: { phone: "+33600000000" },
      shares: [{ sharedWithUser: { phone: null } }, { sharedWithUser: { phone: "+33600000001" } }],
      organization: { members: [{ user: { phone: null } }] },
    } as never);

    const phones = await listProjectPhoneRecipients("proj-1");

    expect(phones.sort()).toEqual(["+33600000000", "+33600000001"].sort());
  });

  it("dédoublonne les numéros identiques entre propriétaire, partages et organisation", async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      user: { phone: "+33600000000" },
      shares: [{ sharedWithUser: { phone: "+33600000000" } }],
      organization: { members: [{ user: { phone: "+33600000000" } }] },
    } as never);

    expect(await listProjectPhoneRecipients("proj-1")).toEqual(["+33600000000"]);
  });
});
