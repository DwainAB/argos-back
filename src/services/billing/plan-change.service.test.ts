import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./subscription.service", () => ({
  SOLO_PROJECT_LIMIT: 3,
  createPlanChangePortalSession: vi.fn(),
  scheduleDowngradeAtPeriodEnd: vi.fn(),
}));
vi.mock("./log-stream-control.service", () => ({
  startLogStreamForAnyProvider: vi.fn(),
  stopLogStreamForProject: vi.fn(),
}));

import {
  applyConfirmedPlanChange,
  downgradeToSoloPlan,
  getDowngradePreview,
  PlanChangeError,
  upgradeToBusinessPlan,
} from "./plan-change.service";
import { createPlanChangePortalSession, scheduleDowngradeAtPeriodEnd } from "./subscription.service";
import { startLogStreamForAnyProvider, stopLogStreamForProject } from "./log-stream-control.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(createPlanChangePortalSession).mockReset();
  vi.mocked(scheduleDowngradeAtPeriodEnd).mockReset();
  vi.mocked(startLogStreamForAnyProvider).mockReset();
  vi.mocked(stopLogStreamForProject).mockReset();
  prismaMock.$transaction.mockImplementation(((arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prismaMock) => unknown)(prismaMock);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }) as typeof prismaMock.$transaction);
});

describe("getDowngradePreview", () => {
  it("signale blockedByMembers si l'organisation a plus d'un membre", async () => {
    prismaMock.organizationMembership.count.mockResolvedValue(2);
    prismaMock.project.findMany.mockResolvedValue([]);

    const preview = await getDowngradePreview("org-1");

    expect(preview.blockedByMembers).toBe(true);
    expect(preview.requiresProjectSelection).toBe(false);
  });

  it("signale requiresProjectSelection si plus de projets actifs que la limite Solo", async () => {
    prismaMock.organizationMembership.count.mockResolvedValue(1);
    prismaMock.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }] as never);

    const preview = await getDowngradePreview("org-1");

    expect(preview.requiresProjectSelection).toBe(true);
  });
});

describe("upgradeToBusinessPlan", () => {
  it("rejette si le nom d'organisation est vide", async () => {
    await expect(
      upgradeToBusinessPlan({ userId: "user-1", organizationName: "  ", returnUrl: "https://x.com" }),
    ).rejects.toThrow("nom de l'organisation est requis");
  });

  it("rejette si l'utilisateur est déjà membre d'une organisation", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1" } as never);

    await expect(
      upgradeToBusinessPlan({ userId: "user-1", organizationName: "Ma Société", returnUrl: "https://x.com" }),
    ).rejects.toThrow("déjà membre d'une organisation");
  });

  it("rejette si aucun abonnement Solo n'existe", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    await expect(
      upgradeToBusinessPlan({ userId: "user-1", organizationName: "Ma Société", returnUrl: "https://x.com" }),
    ).rejects.toThrow("Aucun abonnement Solo actif");
  });

  it("rejette si l'abonnement Solo n'a pas encore d'identifiant Stripe", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findUnique.mockResolvedValue({ id: "sub-1", stripeSubscriptionId: null } as never);

    await expect(
      upgradeToBusinessPlan({ userId: "user-1", organizationName: "Ma Société", returnUrl: "https://x.com" }),
    ).rejects.toThrow("n'est pas encore actif");
  });

  it("crée la session du portail de changement de plan avec le nom nettoyé", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findUnique.mockResolvedValue({ id: "sub-1", stripeSubscriptionId: "stripe_sub_1" } as never);
    vi.mocked(createPlanChangePortalSession).mockResolvedValue("https://billing.stripe.com/portal-1");

    const url = await upgradeToBusinessPlan({ userId: "user-1", organizationName: "  Ma Société  ", returnUrl: "https://x.com" });

    expect(url).toBe("https://billing.stripe.com/portal-1");
    expect(createPlanChangePortalSession).toHaveBeenCalledWith("sub-1", "https://x.com", { organizationName: "Ma Société" });
  });
});

describe("downgradeToSoloPlan", () => {
  it("rejette si l'utilisateur n'appartient à aucune organisation", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);

    await expect(downgradeToSoloPlan({ userId: "user-1" })).rejects.toThrow("n'appartenez à aucune organisation");
  });

  it("rejette si l'utilisateur n'est pas administrateur", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "user" } as never);

    await expect(downgradeToSoloPlan({ userId: "user-1" })).rejects.toThrow("Seul un administrateur");
  });

  it("rejette si l'organisation a plus d'un membre", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.count.mockResolvedValue(2);
    prismaMock.project.findMany.mockResolvedValue([]);

    await expect(downgradeToSoloPlan({ userId: "user-1" })).rejects.toThrow("Retirez les autres membres");
  });

  it("rejette si trop de projets actifs sans sélection valide", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.count.mockResolvedValue(1);
    prismaMock.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }] as never);

    await expect(downgradeToSoloPlan({ userId: "user-1", keepProjectIds: [] })).rejects.toThrow(
      "Sélectionnez entre 1 et 3 projets",
    );
  });

  it("rejette si aucun abonnement Business n'existe", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.count.mockResolvedValue(1);
    prismaMock.project.findMany.mockResolvedValue([]);
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    await expect(downgradeToSoloPlan({ userId: "user-1" })).rejects.toThrow("Aucun abonnement Business actif");
  });

  it("programme le downgrade avec les projets à garder sérialisés", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue({ organizationId: "org-1", role: "admin" } as never);
    prismaMock.organizationMembership.count.mockResolvedValue(1);
    prismaMock.project.findMany.mockResolvedValue([]);
    prismaMock.subscription.findUnique.mockResolvedValue({ id: "sub-1", stripeSubscriptionId: "stripe_sub_1" } as never);
    vi.mocked(scheduleDowngradeAtPeriodEnd).mockResolvedValue({ effectiveAt: new Date("2026-02-01") });

    const result = await downgradeToSoloPlan({ userId: "user-1" });

    expect(result).toEqual({ effectiveAt: new Date("2026-02-01") });
    expect(scheduleDowngradeAtPeriodEnd).toHaveBeenCalledWith("sub-1", "solo", { keepProjectIds: "[]" });
  });
});

describe("applyConfirmedPlanChange", () => {
  it("lève si un upgrade business n'a pas de userId porteur", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ id: "sub-1", userId: null } as never);

    await expect(applyConfirmedPlanChange("sub-1", "business", {})).rejects.toThrow("aucun userId porteur");
  });

  it("lève si l'upgrade business n'a pas organizationName dans les metadata", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ id: "sub-1", userId: "user-1" } as never);

    await expect(applyConfirmedPlanChange("sub-1", "business", {})).rejects.toThrow("organizationName absent");
  });

  it("applique l'upgrade vers business : crée l'organisation et bascule l'abonnement", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ id: "sub-1", userId: "user-1" } as never);
    prismaMock.project.findMany.mockResolvedValue([]);
    prismaMock.organization.create.mockResolvedValue({ id: "org-1" } as never);
    prismaMock.organizationMembership.create.mockResolvedValue({} as never);
    prismaMock.project.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.projectShare.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.subscription.update.mockResolvedValue({} as never);

    await applyConfirmedPlanChange("sub-1", "business", { organizationName: "Ma Société" });

    expect(prismaMock.organization.create).toHaveBeenCalledWith({ data: { name: "Ma Société" } });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { userId: null, organizationId: "org-1", plan: "business" },
    });
  });

  it("lève si un downgrade n'a pas d'organizationId porteuse", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ id: "sub-1", organizationId: null } as never);

    await expect(applyConfirmedPlanChange("sub-1", "solo", {})).rejects.toThrow("aucune organizationId porteuse");
  });

  it("lève si aucun admin n'est trouvé pour l'organisation en downgrade", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ id: "sub-1", organizationId: "org-1" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue(null);

    await expect(applyConfirmedPlanChange("sub-1", "solo", {})).rejects.toThrow("aucun admin trouvé");
  });

  it("applique le downgrade vers solo en nettoyant l'organisation", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ id: "sub-1", organizationId: "org-1" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue({ userId: "user-1" } as never);
    prismaMock.project.findMany.mockResolvedValue([]);
    prismaMock.projectShare.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.project.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.subscription.update.mockResolvedValue({} as never);
    prismaMock.organizationMembership.delete.mockResolvedValue({} as never);
    prismaMock.organization.delete.mockResolvedValue({} as never);
    prismaMock.user.update.mockResolvedValue({} as never);

    await applyConfirmedPlanChange("sub-1", "solo", { keepProjectIds: '["p1"]' });

    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { organizationId: null, userId: "user-1", plan: "solo" },
    });
    expect(prismaMock.organization.delete).toHaveBeenCalledWith({ where: { id: "org-1" } });
  });

  it("retombe sur une liste vide si keepProjectIds n'est pas un JSON valide", async () => {
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ id: "sub-1", organizationId: "org-1" } as never);
    prismaMock.organizationMembership.findFirst.mockResolvedValue({ userId: "user-1" } as never);
    prismaMock.project.findMany.mockResolvedValue([{ id: "p1" }] as never);
    prismaMock.projectShare.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.project.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.subscription.update.mockResolvedValue({} as never);
    prismaMock.organizationMembership.delete.mockResolvedValue({} as never);
    prismaMock.organization.delete.mockResolvedValue({} as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.project.delete.mockResolvedValue({} as never);

    await applyConfirmedPlanChange("sub-1", "solo", { keepProjectIds: "pas-du-json" });

    // keepProjectIds invalide => liste vide => le seul projet actif (p1) est supprimé.
    expect(prismaMock.project.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(stopLogStreamForProject).toHaveBeenCalledWith("p1");
  });
});
