import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/billing/subscription.service", async () => {
  const actual = await vi.importActual<typeof import("../services/billing/subscription.service")>(
    "../services/billing/subscription.service",
  );
  return {
    ...actual,
    createBillingPortalSession: vi.fn(),
    createCheckoutSession: vi.fn(),
    getOrCreateSubscriptionForRequestingUser: vi.fn(),
    getSubscriptionForRequestingUser: vi.fn(),
  };
});

import { subscriptionRouter } from "./subscription.route";
import {
  createBillingPortalSession,
  createCheckoutSession,
  getOrCreateSubscriptionForRequestingUser,
  getSubscriptionForRequestingUser,
  SubscriptionError,
} from "../services/billing/subscription.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(createBillingPortalSession).mockReset();
  vi.mocked(createCheckoutSession).mockReset();
  vi.mocked(getOrCreateSubscriptionForRequestingUser).mockReset();
  vi.mocked(getSubscriptionForRequestingUser).mockReset();
});

describe("GET /api/subscription/me", () => {
  const handler = getRouteHandler(subscriptionRouter, "get", "/api/subscription/me");

  it("renvoie 404 si l'utilisateur n'a pas d'abonnement", async () => {
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue(null);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie les détails de l'abonnement avec les quotas correspondant au plan", async () => {
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue({
      plan: "solo",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      blockedAt: null,
      lastPaymentFailedAt: null,
      smsUsedThisPeriod: 2,
      fixesUsedThisPeriod: 1,
      codeAnalysesUsedThisPeriod: 0,
    } as never);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({
          plan: "solo",
          sms: { used: 2, limit: 10 },
        }),
      }),
    );
  });

  it("renvoie 500 si une erreur inattendue survient", async () => {
    vi.mocked(getSubscriptionForRequestingUser).mockRejectedValue(new Error("boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(500);
    consoleError.mockRestore();
  });
});

describe("POST /api/subscription/checkout", () => {
  const handler = getRouteHandler(subscriptionRouter, "post", "/api/subscription/checkout");

  it("crée la session de checkout et renvoie son url", async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", email: "user@example.com" } as never);
    vi.mocked(getOrCreateSubscriptionForRequestingUser).mockResolvedValue({ id: "sub-1" } as never);
    vi.mocked(createCheckoutSession).mockResolvedValue("https://checkout.stripe.com/session-1");
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ url: "https://checkout.stripe.com/session-1" });
  });

  it("propage le code d'erreur d'une SubscriptionError", async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", email: "user@example.com" } as never);
    vi.mocked(getOrCreateSubscriptionForRequestingUser).mockRejectedValue(
      new SubscriptionError("Plan non autorisé.", 422),
    );
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: "Plan non autorisé." });
  });
});

describe("POST /api/subscription/portal", () => {
  const handler = getRouteHandler(subscriptionRouter, "post", "/api/subscription/portal");

  it("renvoie 404 si l'utilisateur n'a pas d'abonnement", async () => {
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue(null);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie l'url du portail de facturation", async () => {
    vi.mocked(getSubscriptionForRequestingUser).mockResolvedValue({ id: "sub-1" } as never);
    vi.mocked(createBillingPortalSession).mockResolvedValue("https://billing.stripe.com/portal-1");
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ url: "https://billing.stripe.com/portal-1" });
  });
});
