import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/billing/plan-change.service", () => ({
  PlanChangeError: class PlanChangeError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  downgradeToSoloPlan: vi.fn(),
  getDowngradePreview: vi.fn(),
  upgradeToBusinessPlan: vi.fn(),
}));
vi.mock("../services/billing/subscription.service", () => ({
  SubscriptionError: class SubscriptionError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  getSubscriptionForRequestingUser: vi.fn(),
  previewPlanChange: vi.fn(),
}));

import { planChangeRouter } from "./plan-change.route";
import { downgradeToSoloPlan, getDowngradePreview, upgradeToBusinessPlan } from "../services/billing/plan-change.service";
import { getSubscriptionForRequestingUser, previewPlanChange } from "../services/billing/subscription.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(downgradeToSoloPlan).mockReset();
  vi.mocked(getDowngradePreview).mockReset();
  vi.mocked(upgradeToBusinessPlan).mockReset();
  vi.mocked(getSubscriptionForRequestingUser).mockReset();
  vi.mocked(previewPlanChange).mockReset();
});

describe("GET /api/subscription/preview-plan-change", () => {
  const handler = getRouteHandler(planChangeRouter, "get", "/api/subscription/preview-plan-change");

  it("renvoie 400 si le plan demandé est invalide", async () => {
    const res = makeRes();

    await handler({ query: { plan: "autre" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 404 si aucun abonnement n'existe", async () => {
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue(null);
    const res = makeRes();

    await handler({ query: { plan: "business" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie l'aperçu du changement de plan", async () => {
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue({ id: "sub-1" } as never);
    vi.mocked(previewPlanChange).mockResolvedValue({ amountDue: 1000, currency: "eur" });
    const res = makeRes();

    await handler({ query: { plan: "business" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ amountDue: 1000, currency: "eur" });
  });
});

describe("GET /api/subscription/downgrade-preview", () => {
  const handler = getRouteHandler(planChangeRouter, "get", "/api/subscription/downgrade-preview");

  it("renvoie 422 si l'utilisateur n'appartient à aucune organisation", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("renvoie l'aperçu de downgrade", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1" } as never);
    vi.mocked(getDowngradePreview).mockResolvedValue({
      memberCount: 1,
      activeProjects: [],
      blockedByMembers: false,
      requiresProjectSelection: false,
    });
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ blockedByMembers: false }));
  });
});

describe("POST /api/subscription/upgrade-to-business", () => {
  const handler = getRouteHandler(planChangeRouter, "post", "/api/subscription/upgrade-to-business");

  it("renvoie l'url du portail de confirmation", async () => {
    vi.mocked(upgradeToBusinessPlan).mockResolvedValue("https://billing.stripe.com/portal-1");
    const res = makeRes();

    await handler({ body: { organizationName: "Ma Société" }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ portalUrl: "https://billing.stripe.com/portal-1" });
  });
});

describe("POST /api/subscription/downgrade-to-solo", () => {
  const handler = getRouteHandler(planChangeRouter, "post", "/api/subscription/downgrade-to-solo");

  it("renvoie la date effective du downgrade", async () => {
    vi.mocked(downgradeToSoloPlan).mockResolvedValue({ effectiveAt: new Date("2026-02-01") });
    const res = makeRes();

    await handler({ body: { keepProjectIds: ["p1"] }, userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ effectiveAt: new Date("2026-02-01") });
    expect(downgradeToSoloPlan).toHaveBeenCalledWith({ userId: "user-1", keepProjectIds: ["p1"] });
  });
});
