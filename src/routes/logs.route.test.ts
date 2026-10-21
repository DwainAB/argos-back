import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/providers/railway/railway-project-token.service", () => ({ fetchLatestDeployment: vi.fn() }));
vi.mock("../services/providers/render/render-api.service", () => ({ fetchLatestDeployment: vi.fn() }));
vi.mock("../lib/encryption", () => ({ decryptSecret: vi.fn() }));
vi.mock("../services/logs/log-explanation.service", () => ({ explainLog: vi.fn() }));
vi.mock("../services/organization/project-access.service", () => ({ projectAccessFilter: vi.fn().mockResolvedValue({}) }));
vi.mock("../services/organization/organization.service", () => ({
  assertCanManageProject: vi.fn(),
  OrganizationError: class OrganizationError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("../services/activity/activity-log.service", () => ({
  logActivity: vi.fn(),
  getLastActors: vi.fn().mockResolvedValue(new Map()),
  ACTIVITY_ACTIONS: { PROJECT_CREATED: "PROJECT_CREATED", PROJECT_RENAMED: "PROJECT_RENAMED", PROJECT_DELETED: "PROJECT_DELETED" },
}));

import { logsRouter } from "./logs.route";
import { assertCanManageProject, OrganizationError } from "../services/organization/organization.service";
import { explainLog } from "../services/logs/log-explanation.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(assertCanManageProject).mockReset();
  vi.mocked(explainLog).mockReset();
});

describe("GET /api/projects/:projectId/logs", () => {
  const handler = getRouteHandler(logsRouter, "get", "/api/projects/:projectId/logs");

  it("renvoie 404 si le projet n'existe pas ou n'est pas accessible", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, query: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie les logs du projet en limitant à 500 maximum", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    prismaMock.logEntry.findMany.mockResolvedValue([{ id: "log-1" }] as never);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, query: { limit: "9999" }, userId: "user-1" } as never, res);

    expect(prismaMock.logEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    expect(res.json).toHaveBeenCalledWith({ logs: [{ id: "log-1" }] });
  });
});

describe("GET /api/projects/:projectId/overview", () => {
  const handler = getRouteHandler(logsRouter, "get", "/api/projects/:projectId/overview");

  it("renvoie 404 si le projet n'existe pas", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie les compteurs d'erreurs/avertissements sans déploiement si aucun provider configuré", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1", railwayProjectToken: null, renderApiKeyRef: null } as never);
    prismaMock.logEntry.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ latestDeployment: null, errorCount: 3, warningCount: 1 });
  });
});

describe("GET /api/projects/:projectId/timeseries", () => {
  const handler = getRouteHandler(logsRouter, "get", "/api/projects/:projectId/timeseries");

  it("renvoie 404 si le projet n'existe pas", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, query: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("retombe sur la plage '24h' par défaut si la plage demandée est invalide", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    prismaMock.logEntry.findMany.mockResolvedValue([]);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, query: { range: "invalide" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ range: "24h" }));
  });

  it("construit 7 buckets journaliers pour la plage '7d'", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    prismaMock.logEntry.findMany.mockResolvedValue([]);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, query: { range: "7d" }, userId: "user-1" } as never, res);

    const call = vi.mocked(res.json).mock.calls[0][0] as { points: unknown[] };
    expect(call.points).toHaveLength(7);
  });
});

describe("GET /api/projects", () => {
  const handler = getRouteHandler(logsRouter, "get", "/api/projects");

  it("renvoie la liste des projets accessibles", async () => {
    prismaMock.project.findMany.mockResolvedValue([{ id: "proj-1" }] as never);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ projects: [{ id: "proj-1", createdBy: null }] });
  });
});

describe("PATCH /api/projects/:projectId", () => {
  const handler = getRouteHandler(logsRouter, "patch", "/api/projects/:projectId");

  it("renvoie 400 si le nom est vide", async () => {
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, body: { name: "  " }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 404 si le projet n'existe pas", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, body: { name: "Nouveau nom" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie le code d'erreur d'une OrganizationError si l'utilisateur n'a pas les droits", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1", name: "Ancien nom" } as never);
    vi.mocked(assertCanManageProject).mockRejectedValue(new OrganizationError("Accès refusé.", 403));
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, body: { name: "Nouveau nom" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("renomme le projet et journalise l'activité si le nom a changé", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1", name: "Ancien nom" } as never);
    vi.mocked(assertCanManageProject).mockResolvedValue(undefined as never);
    prismaMock.project.update.mockResolvedValue({ id: "proj-1", name: "Nouveau nom" } as never);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, body: { name: "Nouveau nom" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ project: { id: "proj-1", name: "Nouveau nom" } });
  });
});

describe("DELETE /api/projects/:projectId", () => {
  const handler = getRouteHandler(logsRouter, "delete", "/api/projects/:projectId");

  it("renvoie 404 si le projet n'existe pas", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("supprime le projet et répond 204", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1", name: "Projet" } as never);
    vi.mocked(assertCanManageProject).mockResolvedValue(undefined as never);
    prismaMock.project.delete.mockResolvedValue({} as never);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});

describe("POST /api/logs/:logEntryId/explain", () => {
  const handler = getRouteHandler(logsRouter, "post", "/api/logs/:logEntryId/explain");

  it("renvoie 404 si le log n'existe pas", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { logEntryId: "log-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie directement le résumé déjà en cache sans rappeler l'IA", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue({ id: "log-1", aiSummary: "déjà expliqué" } as never);
    const res = makeRes();

    await handler({ params: { logEntryId: "log-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ explanation: "déjà expliqué", cached: true });
    expect(explainLog).not.toHaveBeenCalled();
  });
});
