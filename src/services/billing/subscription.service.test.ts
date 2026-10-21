import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../notifications/email.service", () => ({
  sendPaymentFailedEmail: vi.fn(),
  sendUsageLimitReachedEmail: vi.fn(),
  sendUsageLimitWarningEmail: vi.fn(),
}));
vi.mock("./log-stream-control.service", () => ({
  startAllLogStreamsForSubscription: vi.fn(),
  stopAllLogStreamsForSubscription: vi.fn(),
}));

import {
  handleStripeWebhookEvent,
  hasActiveAccess,
  QUOTAS,
  tryConsumeFixQuota,
  tryConsumeSmsQuota,
} from "./subscription.service";
import {
  sendPaymentFailedEmail,
  sendUsageLimitReachedEmail,
  sendUsageLimitWarningEmail,
} from "../notifications/email.service";
import { startAllLogStreamsForSubscription, stopAllLogStreamsForSubscription } from "./log-stream-control.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(sendPaymentFailedEmail).mockReset();
  vi.mocked(sendUsageLimitReachedEmail).mockReset();
  vi.mocked(sendUsageLimitWarningEmail).mockReset();
  vi.mocked(startAllLogStreamsForSubscription).mockReset();
  vi.mocked(stopAllLogStreamsForSubscription).mockReset();
});

describe("hasActiveAccess", () => {
  it("refuse l'accès si l'abonnement est null", () => {
    expect(hasActiveAccess(null)).toBe(false);
  });

  it("autorise l'accès en statut trialing", () => {
    expect(hasActiveAccess({ status: "trialing" })).toBe(true);
  });

  it("autorise l'accès en statut active", () => {
    expect(hasActiveAccess({ status: "active" })).toBe(true);
  });

  it("autorise l'accès en statut past_due tant que blockedAt est null", () => {
    expect(hasActiveAccess({ status: "past_due", blockedAt: null })).toBe(true);
  });

  it("refuse l'accès en statut past_due une fois blockedAt renseigné", () => {
    expect(hasActiveAccess({ status: "past_due", blockedAt: new Date() })).toBe(false);
  });

  it("refuse l'accès pour les autres statuts (canceled, incomplete...)", () => {
    expect(hasActiveAccess({ status: "canceled" })).toBe(false);
    expect(hasActiveAccess({ status: "incomplete" })).toBe(false);
  });
});

describe("tryConsumeSmsQuota", () => {
  const baseSubscription = {
    id: "sub-1",
    plan: "solo" as const,
    smsUsedThisPeriod: 0,
    smsLimitWarningsSentThisPeriod: 0,
  };

  it("autorise et incrémente le compteur quand le quota n'est pas atteint", async () => {
    prismaMock.subscription.update.mockResolvedValue({} as never);

    const allowed = await tryConsumeSmsQuota(baseSubscription, "user@example.com");

    expect(allowed).toBe(true);
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { smsUsedThisPeriod: { increment: 1 } },
    });
    expect(sendUsageLimitReachedEmail).not.toHaveBeenCalled();
    expect(sendUsageLimitWarningEmail).not.toHaveBeenCalled();
  });

  it("envoie un email d'avertissement en approchant la limite (>=80%) sans bloquer", async () => {
    vi.mocked(sendUsageLimitWarningEmail).mockResolvedValue(undefined as never);
    prismaMock.subscription.update.mockResolvedValue({} as never);

    const allowed = await tryConsumeSmsQuota(
      { ...baseSubscription, smsUsedThisPeriod: QUOTAS.solo.sms - 1 },
      "user@example.com",
    );

    expect(allowed).toBe(true);
    expect(sendUsageLimitWarningEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com", resource: "SMS" }),
    );
  });

  it("bloque et envoie un email de limite atteinte quand le quota est dépassé", async () => {
    vi.mocked(sendUsageLimitReachedEmail).mockResolvedValue(undefined as never);
    prismaMock.subscription.update.mockResolvedValue({} as never);

    const allowed = await tryConsumeSmsQuota(
      { ...baseSubscription, smsUsedThisPeriod: QUOTAS.solo.sms },
      "user@example.com",
    );

    expect(allowed).toBe(false);
    expect(sendUsageLimitReachedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com", resource: "SMS" }),
    );
  });

  it("n'envoie pas deux fois l'email de limite une fois déjà notifié", async () => {
    const allowed = await tryConsumeSmsQuota(
      { ...baseSubscription, smsUsedThisPeriod: QUOTAS.solo.sms, smsLimitWarningsSentThisPeriod: 2 },
      "user@example.com",
    );

    expect(allowed).toBe(false);
    expect(sendUsageLimitReachedEmail).not.toHaveBeenCalled();
  });

  it("applique le quota business quand le plan est business", async () => {
    prismaMock.subscription.update.mockResolvedValue({} as never);

    const allowed = await tryConsumeSmsQuota(
      { ...baseSubscription, plan: "business", smsUsedThisPeriod: QUOTAS.solo.sms },
      "user@example.com",
    );

    expect(allowed).toBe(true);
  });
});

describe("tryConsumeFixQuota", () => {
  it("n'incrémente jamais le compteur lui-même (laissé à consumeFixQuota)", async () => {
    const allowed = await tryConsumeFixQuota(
      { id: "sub-1", plan: "solo", fixesUsedThisPeriod: 0, fixesLimitWarningsSentThisPeriod: 0 },
      "user@example.com",
    );

    expect(allowed).toBe(true);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });
});

describe("handleStripeWebhookEvent", () => {
  it("ignore un événement déjà traité (idempotence)", async () => {
    prismaMock.stripeEvent.findUnique.mockResolvedValue({ id: "evt_1", type: "invoice.paid" } as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleStripeWebhookEvent({ id: "evt_1", type: "invoice.paid" } as never);

    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("déjà traité"));
    consoleError.mockRestore();
  });

  it("traite customer.subscription.deleted : passe l'abonnement à canceled et arrête le streaming", async () => {
    prismaMock.stripeEvent.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findUnique.mockResolvedValue({ id: "sub-1" } as never);
    prismaMock.subscription.update.mockResolvedValue({} as never);
    prismaMock.stripeEvent.create.mockResolvedValue({} as never);
    vi.mocked(stopAllLogStreamsForSubscription).mockResolvedValue(undefined as never);

    await handleStripeWebhookEvent({
      id: "evt_2",
      type: "customer.subscription.deleted",
      data: { object: { id: "stripe_sub_1" } },
    } as never);

    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { status: "canceled", cancelAtPeriodEnd: false },
    });
    expect(stopAllLogStreamsForSubscription).toHaveBeenCalledWith({ id: "sub-1" });
    expect(prismaMock.stripeEvent.create).toHaveBeenCalledWith({ data: { id: "evt_2", type: "customer.subscription.deleted" } });
  });

  it("ignore un événement de type non géré sans planter", async () => {
    prismaMock.stripeEvent.findUnique.mockResolvedValue(null);
    prismaMock.stripeEvent.create.mockResolvedValue({} as never);

    await expect(
      handleStripeWebhookEvent({ id: "evt_3", type: "customer.updated" } as never),
    ).resolves.toBeUndefined();

    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it("ignore customer.subscription.deleted si aucun abonnement local ne correspond", async () => {
    prismaMock.stripeEvent.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    prismaMock.stripeEvent.create.mockResolvedValue({} as never);

    await handleStripeWebhookEvent({
      id: "evt_4",
      type: "customer.subscription.deleted",
      data: { object: { id: "stripe_sub_inconnu" } },
    } as never);

    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    expect(stopAllLogStreamsForSubscription).not.toHaveBeenCalled();
  });
});
