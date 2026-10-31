import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

// vi.hoisted : la fonction doit exister avant les vi.mock, remontés en tête de fichier.
const sessionsCreate = vi.hoisted(() => vi.fn());

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../../config/env", async () => {
  const actual = await vi.importActual<typeof import("../../config/env")>("../../config/env");
  return {
    env: {
      ...actual.env,
      frontendUrl: "https://ai-argos.com",
      stripe: { ...actual.env.stripe, secretKey: "sk_test_fake", priceSolo: "price_solo", priceBusiness: "price_business" },
    },
  };
});
vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: sessionsCreate } };
  },
}));

import { createCheckoutSession } from "./subscription.service";

beforeEach(() => {
  resetPrismaMock();
  sessionsCreate.mockReset().mockResolvedValue({ url: "https://checkout.stripe.com/session" });
});

describe("createCheckoutSession", () => {
  it("autorise la saisie d'un code promo sur la page de paiement", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({
      id: "sub-1",
      plan: "business",
      userId: null,
      stripeCustomerId: "cus_1",
    } as never);

    const url = await createCheckoutSession("sub-1");

    expect(url).toBe("https://checkout.stripe.com/session");
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ allow_promotion_codes: true }));
  });

  it("garde l'essai gratuit Solo pour un compte qui ne l'a jamais utilisé", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({
      id: "sub-1",
      plan: "solo",
      userId: "user-1",
      stripeCustomerId: "cus_1",
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", hasUsedTrial: false } as never);

    await createCheckoutSession("sub-1");

    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ allow_promotion_codes: true, subscription_data: { trial_period_days: expect.any(Number) } }),
    );
  });
});
