import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAccessibleServices, fetchLatestDeployment } from "./render-api.service";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAccessibleServices", () => {
  it("extrait les services de la réponse Render", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ service: { id: "srv-1", name: "api", ownerId: "owner-1", type: "web_service" } }],
    });

    const result = await fetchAccessibleServices("api-key-123");

    expect(result).toEqual([{ id: "srv-1", name: "api", ownerId: "owner-1", type: "web_service" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.render.com/v1/services?limit=100",
      expect.objectContaining({ headers: { Authorization: "Bearer api-key-123" } }),
    );
  });

  it("lève une erreur détaillée si la réponse HTTP échoue", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });

    await expect(fetchAccessibleServices("mauvaise-cle")).rejects.toThrow("Erreur API Render (401)");
  });
});

describe("fetchLatestDeployment", () => {
  it("renvoie null si aucun déploiement n'existe", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    const result = await fetchLatestDeployment("api-key-123", { resourceId: "srv-1" });

    expect(result).toBeNull();
  });

  it("normalise le statut 'live' en 'SUCCESS'", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ deploy: { id: "deploy-1", status: "live", createdAt: "2026-01-01" } }],
    });

    const result = await fetchLatestDeployment("api-key-123", { resourceId: "srv-1" });

    expect(result).toEqual({ id: "deploy-1", status: "SUCCESS", createdAt: "2026-01-01" });
  });

  it("normalise les statuts d'échec (build_failed...) en 'FAILED'", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ deploy: { id: "deploy-2", status: "build_failed", createdAt: "2026-01-02" } }],
    });

    const result = await fetchLatestDeployment("api-key-123", { resourceId: "srv-1" });

    expect(result?.status).toBe("FAILED");
  });

  it("normalise les statuts annulés/désactivés en 'CRASHED'", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ deploy: { id: "deploy-3", status: "canceled", createdAt: "2026-01-03" } }],
    });

    const result = await fetchLatestDeployment("api-key-123", { resourceId: "srv-1" });

    expect(result?.status).toBe("CRASHED");
  });

  it("met en majuscules un statut inconnu tel quel", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ deploy: { id: "deploy-4", status: "queued", createdAt: "2026-01-04" } }],
    });

    const result = await fetchLatestDeployment("api-key-123", { resourceId: "srv-1" });

    expect(result?.status).toBe("QUEUED");
  });
});
