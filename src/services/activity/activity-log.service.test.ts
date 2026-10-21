import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));

import { ACTIVITY_ACTIONS, getLastActor, getLastActors, logActivity } from "./activity-log.service";
import { logger } from "../../lib/logger";

beforeEach(() => {
  resetPrismaMock();
});

describe("logActivity", () => {
  it("écrit une entrée dans le journal d'activité", async () => {
    prismaMock.activityLog.create.mockResolvedValue({} as never);

    await logActivity({
      userId: "user-1",
      action: ACTIVITY_ACTIONS.PROJECT_CREATED,
      entityType: "Project",
      entityId: "proj-1",
    });

    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "project.created",
        entityType: "Project",
        entityId: "proj-1",
        projectId: null,
        metadata: undefined,
      },
    });
  });

  it("avale l'erreur sans la propager si l'écriture échoue", async () => {
    prismaMock.activityLog.create.mockRejectedValue(new Error("DB down"));
    const consoleError = vi.spyOn(logger, "error").mockImplementation(() => {});

    await expect(
      logActivity({ userId: "user-1", action: ACTIVITY_ACTIONS.PROJECT_CREATED, entityType: "Project", entityId: "proj-1" }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("getLastActor", () => {
  it("renvoie null si aucune entrée n'existe", async () => {
    prismaMock.activityLog.findFirst.mockResolvedValue(null);

    await expect(getLastActor("Alert", "alert-1", ACTIVITY_ACTIONS.ALERT_RESOLVED)).resolves.toBeNull();
  });

  it("renvoie null si l'entrée existe mais sans utilisateur associé", async () => {
    prismaMock.activityLog.findFirst.mockResolvedValue({ user: null } as never);

    await expect(getLastActor("Alert", "alert-1", ACTIVITY_ACTIONS.ALERT_RESOLVED)).resolves.toBeNull();
  });

  it("renvoie l'acteur résolu", async () => {
    prismaMock.activityLog.findFirst.mockResolvedValue({
      user: { id: "user-1", firstName: "Jean", lastName: "Dupont" },
    } as never);

    await expect(getLastActor("Alert", "alert-1", ACTIVITY_ACTIONS.ALERT_RESOLVED)).resolves.toEqual({
      userId: "user-1",
      firstName: "Jean",
      lastName: "Dupont",
    });
  });
});

describe("getLastActors", () => {
  it("renvoie une Map vide sans requêter si la liste d'entités est vide", async () => {
    const result = await getLastActors("Alert", [], ACTIVITY_ACTIONS.ALERT_RESOLVED);

    expect(result.size).toBe(0);
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled();
  });

  it("garde uniquement la première entrée (la plus récente) par entité", async () => {
    prismaMock.activityLog.findMany.mockResolvedValue([
      { entityId: "alert-1", user: { id: "u-2", firstName: "Plus", lastName: "Récent" } },
      { entityId: "alert-1", user: { id: "u-1", firstName: "Plus", lastName: "Ancien" } },
      { entityId: "alert-2", user: null },
    ] as never);

    const result = await getLastActors("Alert", ["alert-1", "alert-2"], ACTIVITY_ACTIONS.ALERT_RESOLVED);

    expect(result.get("alert-1")).toEqual({ userId: "u-2", firstName: "Plus", lastName: "Récent" });
    expect(result.has("alert-2")).toBe(false);
  });
});
