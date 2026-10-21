import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/code-analysis/code-analysis.service", () => ({
  estimateCodeAnalysis: vi.fn(),
  runCodeAnalysis: vi.fn().mockResolvedValue({ filesScanned: 0, scores: {}, findings: [] }),
  buildCodeSource: vi.fn(),
}));
vi.mock("../services/organization/project-access.service", () => ({ projectAccessFilter: vi.fn().mockResolvedValue({}) }));
vi.mock("../services/billing/subscription.service", () => ({
  getSubscriptionForRequestingUser: vi.fn(),
  tryConsumeCodeAnalysisQuota: vi.fn(),
}));
vi.mock("../services/activity/activity-log.service", () => ({
  logActivity: vi.fn(),
  getLastActor: vi.fn().mockResolvedValue(null),
  getLastActors: vi.fn().mockResolvedValue(new Map()),
  ACTIVITY_ACTIONS: { CODE_ANALYSIS_STARTED: "CODE_ANALYSIS_STARTED" },
}));

import { codeAnalysisRouter } from "./code-analysis.route";
import { buildCodeSource, estimateCodeAnalysis } from "../services/code-analysis/code-analysis.service";
import { getSubscriptionForRequestingUser, tryConsumeCodeAnalysisQuota } from "../services/billing/subscription.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(buildCodeSource).mockReset();
  vi.mocked(estimateCodeAnalysis).mockReset();
  vi.mocked(getSubscriptionForRequestingUser).mockReset();
  vi.mocked(tryConsumeCodeAnalysisQuota).mockReset();
});

describe("GET /api/projects/:projectId/code-analysis/estimate", () => {
  const handler = getRouteHandler(codeAnalysisRouter, "get", "/api/projects/:projectId/code-analysis/estimate");

  it("renvoie 404 si le projet n'est pas accessible", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie 422 si aucun dépôt n'est connecté", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    vi.mocked(buildCodeSource).mockReturnValue(null as never);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("renvoie l'estimation", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    vi.mocked(buildCodeSource).mockReturnValue({} as never);
    vi.mocked(estimateCodeAnalysis).mockResolvedValue({ estimatedCost: 1.2 } as never);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ estimatedCost: 1.2 });
  });
});

describe("POST /api/projects/:projectId/code-analysis", () => {
  const handler = getRouteHandler(codeAnalysisRouter, "post", "/api/projects/:projectId/code-analysis");

  it("renvoie 404 si le projet n'est pas accessible", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie 422 si aucun dépôt n'est connecté", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    vi.mocked(buildCodeSource).mockReturnValue(null as never);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("renvoie 429 si le quota mensuel d'analyses est atteint", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    vi.mocked(buildCodeSource).mockReturnValue({} as never);
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue({ id: "sub-1" } as never);
    prismaMock.user.findUnique.mockResolvedValue({ email: "user@example.com" } as never);
    vi.mocked(tryConsumeCodeAnalysisQuota).mockResolvedValue(false);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(prismaMock.codeAnalysis.create).not.toHaveBeenCalled();
  });

  it("démarre l'analyse et répond 202 immédiatement", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    vi.mocked(buildCodeSource).mockReturnValue({} as never);
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue(null);
    prismaMock.codeAnalysis.create.mockResolvedValue({ id: "analysis-1", status: "running" } as never);
    prismaMock.codeAnalysis.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ analysis: { id: "analysis-1", status: "running" } });
  });
});

describe("GET /api/projects/:projectId/code-analysis", () => {
  const handler = getRouteHandler(codeAnalysisRouter, "get", "/api/projects/:projectId/code-analysis");

  it("renvoie 404 si le projet n'est pas accessible", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie l'historique des analyses du projet", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    prismaMock.codeAnalysis.findMany.mockResolvedValue([{ id: "analysis-1" }] as never);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ analyses: [{ id: "analysis-1", startedBy: null }] });
  });
});

describe("GET /api/code-analysis/:analysisId", () => {
  const handler = getRouteHandler(codeAnalysisRouter, "get", "/api/code-analysis/:analysisId");

  it("renvoie 404 si l'analyse n'existe pas", async () => {
    prismaMock.codeAnalysis.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { analysisId: "analysis-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("PATCH /api/code-analysis/:analysisId/findings/:findingId", () => {
  const handler = getRouteHandler(codeAnalysisRouter, "patch", "/api/code-analysis/:analysisId/findings/:findingId");

  it("renvoie 400 si le statut n'est pas valide", async () => {
    const res = makeRes();

    await handler({ params: { analysisId: "a-1", findingId: "f-1" }, body: { status: "n'importe quoi" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 404 si l'analyse n'existe pas", async () => {
    prismaMock.codeAnalysis.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { analysisId: "a-1", findingId: "f-1" }, body: { status: "resolved" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie 404 si le finding n'existe pas dans l'analyse", async () => {
    prismaMock.codeAnalysis.findFirst.mockResolvedValue({ id: "a-1", findings: [] } as never);
    const res = makeRes();

    await handler({ params: { analysisId: "a-1", findingId: "f-1" }, body: { status: "resolved" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("met à jour le statut d'un finding et renseigne resolvedBy si résolu", async () => {
    prismaMock.codeAnalysis.findFirst.mockResolvedValue({
      id: "a-1",
      findings: [{ id: "f-1", status: "open" }],
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: "Jean", lastName: "Dupont" } as never);
    prismaMock.codeAnalysis.update.mockResolvedValue({} as never);
    const res = makeRes();

    await handler({ params: { analysisId: "a-1", findingId: "f-1" }, body: { status: "resolved" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({
      finding: expect.objectContaining({
        id: "f-1",
        status: "resolved",
        resolvedBy: { userId: "user-1", firstName: "Jean", lastName: "Dupont" },
      }),
    });
  });
});
