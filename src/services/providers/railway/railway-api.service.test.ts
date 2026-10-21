import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAccessibleProjects, fetchLatestDeploymentLogs, fetchMe } from "./railway-api.service";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe("fetchMe", () => {
  it("renvoie les infos utilisateur quand l'appel réussit", async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ data: { me: { name: "Jean", email: "jean@example.com" } } }));

    const result = await fetchMe("token-123");

    expect(result).toEqual({ me: { name: "Jean", email: "jean@example.com" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://backboard.railway.com/graphql/v2",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-123" }),
      }),
    );
  });

  it("lève une erreur si la réponse HTTP n'est pas ok", async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ errors: ["unauthorized"] }, false));

    await expect(fetchMe("token-invalide")).rejects.toThrow("Erreur API Railway");
  });

  it("lève une erreur si la réponse contient des erreurs GraphQL malgré un statut ok", async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ errors: [{ message: "boom" }] }, true));

    await expect(fetchMe("token-123")).rejects.toThrow("Erreur API Railway");
  });
});

describe("fetchAccessibleProjects", () => {
  it("transforme la réponse GraphQL imbriquée en une liste de projets à plat", async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        data: {
          projects: {
            edges: [
              {
                node: {
                  id: "proj-1",
                  name: "Mon Projet",
                  services: { edges: [{ node: { id: "svc-1", name: "api" } }] },
                  environments: { edges: [{ node: { id: "env-1", name: "production" } }] },
                },
              },
            ],
          },
        },
      }),
    );

    const result = await fetchAccessibleProjects("token-123");

    expect(result).toEqual([
      {
        id: "proj-1",
        name: "Mon Projet",
        services: [{ id: "svc-1", name: "api" }],
        environments: [{ id: "env-1", name: "production" }],
      },
    ]);
  });
});

describe("fetchLatestDeploymentLogs", () => {
  it("renvoie un tableau vide si aucun déploiement n'existe", async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ data: { deployments: { edges: [] } } }));

    const result = await fetchLatestDeploymentLogs("token-123", { serviceId: "svc-1", environmentId: "env-1" });

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("récupère les logs du dernier déploiement trouvé", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: { deployments: { edges: [{ node: { id: "deploy-1", status: "SUCCESS", createdAt: "2026-01-01" } }] } },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: { deploymentLogs: [{ timestamp: "2026-01-01T00:00:00Z", message: "started", severity: "info" }] },
        }),
      );

    const result = await fetchLatestDeploymentLogs("token-123", { serviceId: "svc-1", environmentId: "env-1" });

    expect(result).toEqual([{ timestamp: "2026-01-01T00:00:00Z", message: "started", severity: "info" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
