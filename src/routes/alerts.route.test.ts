import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/code-analysis/fix-suggestion.service", () => ({ suggestFix: vi.fn() }));
vi.mock("../services/code-analysis/fix-change-request.service", () => ({ createFixChangeRequest: vi.fn() }));
vi.mock("../services/code-analysis/code-analysis.service", () => ({ buildCodeSource: vi.fn() }));
vi.mock("../services/organization/project-access.service", () => ({ projectAccessFilter: vi.fn().mockResolvedValue({}) }));
vi.mock("../services/billing/subscription.service", () => ({
  getSubscriptionForRequestingUser: vi.fn(),
  tryConsumeFixQuota: vi.fn(),
  consumeFixQuota: vi.fn(),
}));
vi.mock("../services/activity/activity-log.service", () => ({
  logActivity: vi.fn(),
  getLastActor: vi.fn().mockResolvedValue(null),
  getLastActors: vi.fn().mockResolvedValue(new Map()),
  ACTIVITY_ACTIONS: {
    ALERT_RESOLVED: "ALERT_RESOLVED",
    ALERT_REOPENED: "ALERT_REOPENED",
    FIX_REQUESTED: "FIX_REQUESTED",
    FIX_ACCEPTED: "FIX_ACCEPTED",
    FIX_REJECTED: "FIX_REJECTED",
  },
}));

import { alertsRouter } from "./alerts.route";
import { buildCodeSource } from "../services/code-analysis/code-analysis.service";
import { suggestFix } from "../services/code-analysis/fix-suggestion.service";
import { createFixChangeRequest } from "../services/code-analysis/fix-change-request.service";
import { getSubscriptionForRequestingUser, tryConsumeFixQuota } from "../services/billing/subscription.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(buildCodeSource).mockReset();
  vi.mocked(suggestFix).mockReset();
  vi.mocked(createFixChangeRequest).mockReset();
  vi.mocked(getSubscriptionForRequestingUser).mockReset();
  vi.mocked(tryConsumeFixQuota).mockReset();
});

describe("GET /api/projects/alerts-summary", () => {
  const handler = getRouteHandler(alertsRouter, "get", "/api/projects/alerts-summary");

  it("agrège les comptes d'erreurs/avertissements par projet, triés par total décroissant", async () => {
    prismaMock.project.findMany.mockResolvedValue([
      { id: "proj-1", name: "Projet A" },
      { id: "proj-2", name: "Projet B" },
    ] as never);
    prismaMock.logEntry.findMany.mockResolvedValue([
      { projectId: "proj-2", category: "critical" },
      { projectId: "proj-2", category: "critical" },
      { projectId: "proj-1", category: "warning" },
    ] as never);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({
      summary: [
        { projectId: "proj-2", projectName: "Projet B", errorCount: 2, warningCount: 0 },
        { projectId: "proj-1", projectName: "Projet A", errorCount: 0, warningCount: 1 },
      ],
    });
  });
});

describe("GET /api/projects/:projectId/alerts", () => {
  const handler = getRouteHandler(alertsRouter, "get", "/api/projects/:projectId/alerts");

  it("renvoie 404 si le projet n'est pas accessible", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, query: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie les alertes non résolues par défaut", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    prismaMock.alert.findMany.mockResolvedValue([{ id: "alert-1" }] as never);
    prismaMock.alert.count.mockResolvedValue(1);
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, query: {}, userId: "user-1" } as never, res);

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ resolvedAt: null }) }),
    );
    expect(res.json).toHaveBeenCalledWith({ alerts: [{ id: "alert-1", resolvedBy: null }], total: 1 });
  });
});

describe("GET /api/alerts/:alertId", () => {
  const handler = getRouteHandler(alertsRouter, "get", "/api/alerts/:alertId");

  it("renvoie 404 si l'alerte n'existe pas ou n'est pas accessible", async () => {
    prismaMock.alert.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie l'alerte avec resolvedBy/fixDecidedBy à null quand non applicable", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({ id: "alert-1", resolvedAt: null, status: "open" } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({
      alert: expect.objectContaining({ id: "alert-1", resolvedBy: null, fixDecidedBy: null }),
    });
  });
});

describe("POST /api/alerts/:alertId/resolve", () => {
  const handler = getRouteHandler(alertsRouter, "post", "/api/alerts/:alertId/resolve");

  it("renvoie 404 si l'alerte n'existe pas", async () => {
    prismaMock.alert.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("marque l'alerte comme résolue et journalise l'activité", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({ id: "alert-1", logEntry: { projectId: "proj-1" } } as never);
    prismaMock.alert.update.mockResolvedValue({ id: "alert-1", resolvedAt: new Date() } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ alert: expect.objectContaining({ id: "alert-1" }) });
  });
});

describe("POST /api/alerts/:alertId/reopen", () => {
  const handler = getRouteHandler(alertsRouter, "post", "/api/alerts/:alertId/reopen");

  it("rouvre l'alerte", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({ id: "alert-1", logEntry: { projectId: "proj-1" } } as never);
    prismaMock.alert.update.mockResolvedValue({ id: "alert-1", resolvedAt: null } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ alert: expect.objectContaining({ resolvedAt: null }) });
  });
});

describe("POST /api/alerts/:alertId/fix/request", () => {
  const handler = getRouteHandler(alertsRouter, "post", "/api/alerts/:alertId/fix/request");

  it("renvoie 404 si l'alerte n'existe pas", async () => {
    prismaMock.alert.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie 422 si le problème ne se corrige pas dans le code", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({ id: "alert-1", fixLocation: "infra" } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("renvoie 422 si le projet n'a pas de dépôt connecté", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-1",
      fixLocation: "code",
      logEntry: { project: { id: "proj-1" } },
    } as never);
    vi.mocked(buildCodeSource).mockReturnValue(null as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("renvoie 429 si le quota de corrections IA est atteint", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-1",
      fixLocation: "code",
      logEntry: { project: { id: "proj-1" }, rawMessage: "erreur" },
    } as never);
    vi.mocked(buildCodeSource).mockReturnValue({} as never);
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue({ id: "sub-1" } as never);
    prismaMock.user.findUnique.mockResolvedValue({ email: "user@example.com" } as never);
    vi.mocked(tryConsumeFixQuota).mockResolvedValue(false);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(suggestFix).not.toHaveBeenCalled();
  });

  it("renvoie 422 si l'IA ne propose aucun correctif fiable", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-1",
      fixLocation: "code",
      logEntry: { project: { id: "proj-1" }, rawMessage: "erreur" },
    } as never);
    vi.mocked(buildCodeSource).mockReturnValue({} as never);
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue(null);
    vi.mocked(suggestFix).mockResolvedValue(null);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe("POST /api/alerts/:alertId/fix/accept", () => {
  const handler = getRouteHandler(alertsRouter, "post", "/api/alerts/:alertId/fix/accept");

  it("renvoie 422 si aucun correctif n'est proposé en attente", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-1",
      status: "open",
      logEntry: { project: {} },
    } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, body: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("crée la pull request et marque le correctif comme accepté", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-1",
      status: "fix_proposed",
      proposedFilePath: "src/x.ts",
      proposedOldCode: "a",
      proposedNewCode: "b",
      proposedExplanation: "explication",
      proposedCommitMessage: "fix: x",
      explanation: "explication",
      logEntry: { project: { id: "proj-1" } },
    } as never);
    vi.mocked(buildCodeSource).mockReturnValue({} as never);
    vi.mocked(createFixChangeRequest).mockResolvedValue("https://github.com/owner/repo/pull/1");
    prismaMock.alert.update.mockResolvedValue({ id: "alert-1", status: "fix_accepted" } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, body: {}, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ alert: expect.objectContaining({ status: "fix_accepted" }) });
  });
});

describe("POST /api/alerts/:alertId/fix/reject", () => {
  const handler = getRouteHandler(alertsRouter, "post", "/api/alerts/:alertId/fix/reject");

  it("renvoie 422 si aucun correctif n'est proposé en attente", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({ id: "alert-1", status: "open" } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("rejette le correctif proposé", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-1",
      status: "fix_proposed",
      logEntry: { projectId: "proj-1" },
    } as never);
    prismaMock.alert.update.mockResolvedValue({ id: "alert-1", status: "fix_rejected" } as never);
    const res = makeRes();

    await handler({ params: { alertId: "alert-1" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ alert: expect.objectContaining({ status: "fix_rejected" }) });
  });
});
