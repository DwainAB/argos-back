import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../../test/prisma-mock";

vi.mock("../../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../../../lib/encryption", () => ({ encryptSecret: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("../../organization/organization.service", () => ({ getMembershipForUser: vi.fn() }));

import {
  createRenderApiKey,
  deleteRenderApiKey,
  getDecryptedRenderApiKey,
  listRenderApiKeys,
  RenderApiKeyError,
} from "./render-api-key.service";
import { decryptSecret, encryptSecret } from "../../../lib/encryption";
import { getMembershipForUser } from "../../organization/organization.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(encryptSecret).mockReset();
  vi.mocked(decryptSecret).mockReset();
  vi.mocked(getMembershipForUser).mockReset();
});

describe("listRenderApiKeys", () => {
  it("filtre par userId si l'utilisateur n'appartient à aucune organisation", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.renderApiKey.findMany.mockResolvedValue([]);

    await listRenderApiKeys("user-1");

    expect(prismaMock.renderApiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", organizationId: null } }),
    );
  });

  it("filtre par organizationId si l'utilisateur appartient à une organisation", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue({ organizationId: "org-1" } as never);
    prismaMock.renderApiKey.findMany.mockResolvedValue([]);

    await listRenderApiKeys("user-1");

    expect(prismaMock.renderApiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: null, organizationId: "org-1" } }),
    );
  });
});

describe("createRenderApiKey", () => {
  it("rejette une clé vide", async () => {
    await expect(createRenderApiKey("user-1", { apiKey: "   " })).rejects.toThrow("La clé API est requise");
  });

  it("stocke la clé chiffrée avec un libellé par défaut et les 4 derniers caractères en clair", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    vi.mocked(encryptSecret).mockReturnValue("chiffre-xyz");
    prismaMock.renderApiKey.create.mockResolvedValue({ id: "key-1" } as never);

    await createRenderApiKey("user-1", { apiKey: "rnd_abcdef1234" });

    expect(prismaMock.renderApiKey.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        organizationId: null,
        label: "Clé Render",
        encryptedKey: "chiffre-xyz",
        lastFour: "1234",
      },
      select: { id: true, label: true, lastFour: true, createdAt: true },
    });
  });
});

describe("getDecryptedRenderApiKey", () => {
  it("lève une erreur 404 si la clé n'appartient pas à l'utilisateur", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.renderApiKey.findFirst.mockResolvedValue(null);

    await expect(getDecryptedRenderApiKey("user-1", "key-autre")).rejects.toThrow(RenderApiKeyError);
  });

  it("déchiffre et renvoie la clé en clair", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.renderApiKey.findFirst.mockResolvedValue({ encryptedKey: "chiffre-xyz" } as never);
    vi.mocked(decryptSecret).mockReturnValue("rnd_abcdef1234");

    await expect(getDecryptedRenderApiKey("user-1", "key-1")).resolves.toBe("rnd_abcdef1234");
  });
});

describe("deleteRenderApiKey", () => {
  it("lève une erreur 404 si la clé n'existe pas", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.renderApiKey.findFirst.mockResolvedValue(null);

    await expect(deleteRenderApiKey("user-1", "key-inconnue")).rejects.toThrow("introuvable");
  });

  it("refuse la suppression si la clé est encore utilisée par des projets", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.renderApiKey.findFirst.mockResolvedValue({
      id: "key-1",
      projects: [{ id: "p1", name: "Mon Projet" }],
    } as never);

    await expect(deleteRenderApiKey("user-1", "key-1")).rejects.toThrow("utilisée par 1 projet");
    expect(prismaMock.renderApiKey.delete).not.toHaveBeenCalled();
  });

  it("supprime la clé si elle n'est utilisée par aucun projet", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.renderApiKey.findFirst.mockResolvedValue({ id: "key-1", projects: [] } as never);
    prismaMock.renderApiKey.delete.mockResolvedValue({} as never);

    await deleteRenderApiKey("user-1", "key-1");

    expect(prismaMock.renderApiKey.delete).toHaveBeenCalledWith({ where: { id: "key-1" } });
  });
});
