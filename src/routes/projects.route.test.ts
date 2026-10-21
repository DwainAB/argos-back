import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/providers/railway/railway-project-token.service", () => ({
  fetchLatestDeploymentLogsWithProjectToken: vi.fn(),
}));
vi.mock("../services/providers/railway/railway-log-stream.service", () => ({ startLogStreamForProject: vi.fn() }));
vi.mock("../services/providers/render/render-log-stream.service", () => ({ startLogStreamForProject: vi.fn() }));
vi.mock("../services/providers/render/render-api-key.service", () => ({
  createRenderApiKey: vi.fn(),
  getDecryptedRenderApiKey: vi.fn(),
  RenderApiKeyError: class RenderApiKeyError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("../services/organization/organization.service", () => ({ getMembershipForUser: vi.fn() }));
vi.mock("../services/billing/subscription.service", () => ({ SOLO_PROJECT_LIMIT: 3 }));
vi.mock("../services/activity/activity-log.service", () => ({
  logActivity: vi.fn(),
  ACTIVITY_ACTIONS: { PROJECT_CREATED: "PROJECT_CREATED" },
}));

import { projectsRouter } from "./projects.route";
import { getMembershipForUser } from "../services/organization/organization.service";
import { fetchLatestDeploymentLogsWithProjectToken } from "../services/providers/railway/railway-project-token.service";
import { startLogStreamForProject as startRailwayLogStreamForProject } from "../services/providers/railway/railway-log-stream.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(getMembershipForUser).mockReset();
  vi.mocked(fetchLatestDeploymentLogsWithProjectToken).mockReset();
  vi.mocked(startRailwayLogStreamForProject).mockReset().mockResolvedValue(undefined as never);
});

describe("POST /api/projects", () => {
  const handler = getRouteHandler(projectsRouter, "post", "/api/projects");

  it("renvoie 400 si aucun hébergeur n'est fourni", async () => {
    const res = makeRes();

    await handler({ body: { projectName: "Mon projet" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 400 si les deux hébergeurs sont fournis en même temps", async () => {
    const res = makeRes();

    await handler(
      { body: { railway: { projectToken: "t", serviceId: "s", environmentId: "e" }, render: { ownerId: "o", resourceId: "r", apiKeyId: "k" } }, userId: "user-1" } as never,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 400 si les champs Railway sont incomplets", async () => {
    const res = makeRes();

    await handler({ body: { railway: { projectToken: "t" } }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 403 si l'utilisateur est membre non-admin d'une organisation", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue({ role: "member", organizationId: "org-1" } as never);
    const res = makeRes();

    await handler({ body: { railway: { projectToken: "t", serviceId: "s", environmentId: "e" } }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("renvoie 422 si la limite de projets Solo est atteinte", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.project.count.mockResolvedValue(3);
    const res = makeRes();

    await handler({ body: { railway: { projectToken: "t", serviceId: "s", environmentId: "e" } }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("crée le projet Railway et démarre le streaming", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.project.count.mockResolvedValue(0);
    vi.mocked(fetchLatestDeploymentLogsWithProjectToken).mockResolvedValue([] as never);
    prismaMock.project.create.mockResolvedValue({ id: "proj-1", name: "Mon projet" } as never);
    const res = makeRes();

    await handler(
      {
        body: { projectName: "Mon projet", railway: { projectToken: "t", serviceId: "s", environmentId: "e" } },
        userId: "user-1",
      } as never,
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ project: { id: "proj-1", name: "Mon projet" } });
    expect(startRailwayLogStreamForProject).toHaveBeenCalled();
  });

  it("renvoie 502 si la vérification Railway échoue", async () => {
    vi.mocked(getMembershipForUser).mockResolvedValue(null);
    prismaMock.project.count.mockResolvedValue(0);
    vi.mocked(fetchLatestDeploymentLogsWithProjectToken).mockRejectedValue(new Error("token invalide"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();

    await handler(
      { body: { railway: { projectToken: "t", serviceId: "s", environmentId: "e" } }, userId: "user-1" } as never,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(502);
    consoleError.mockRestore();
  });
});
