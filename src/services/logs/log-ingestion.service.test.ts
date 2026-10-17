import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../../test/prisma-mock";
import type { GroupedLog } from "./log-grouper.service";

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./log-triage.service", () => ({ triageLog: vi.fn() }));
vi.mock("../organization/project-access.service", () => ({
  listProjectRecipients: vi.fn(),
  listProjectPhoneRecipients: vi.fn(),
}));
vi.mock("../notifications/email.service", () => ({ sendAlertEmail: vi.fn() }));
vi.mock("../notifications/sms.service", () => ({ sendAlertSms: vi.fn() }));
vi.mock("../billing/subscription.service", () => ({
  getSubscriptionForProject: vi.fn(),
  tryConsumeSmsQuota: vi.fn(),
}));

import { persistGroupedLog } from "./log-ingestion.service";
import { triageLog } from "./log-triage.service";
import { listProjectPhoneRecipients, listProjectRecipients } from "../organization/project-access.service";
import { sendAlertEmail } from "../notifications/email.service";
import { sendAlertSms } from "../notifications/sms.service";
import { getSubscriptionForProject, tryConsumeSmsQuota } from "../billing/subscription.service";

function makeLog(overrides: Partial<GroupedLog> = {}): GroupedLog {
  return {
    rawMessage: "boom",
    level: "error",
    category: "critical",
    externalTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

// Attend que les promesses détachées (triage, notifications, lancées sans await dans
// persistGroupedLog) aient eu l'occasion de s'exécuter avant d'assert sur leurs effets.
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(triageLog).mockReset();
  vi.mocked(listProjectRecipients).mockReset().mockResolvedValue([]);
  vi.mocked(listProjectPhoneRecipients).mockReset().mockResolvedValue([]);
  vi.mocked(sendAlertEmail).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(sendAlertSms).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getSubscriptionForProject).mockReset().mockResolvedValue(null);
  vi.mocked(tryConsumeSmsQuota).mockReset().mockResolvedValue(true);
});

describe("persistGroupedLog", () => {
  it("ignore un log déjà persisté récemment (doublon) sans le recréer", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue({ id: "existing" } as never);

    await persistGroupedLog("proj-1", "railway", makeLog());

    expect(prismaMock.logEntry.create).not.toHaveBeenCalled();
  });

  it("crée l'entrée avec triageStatus 'none' pour un log non groupable (info)", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    prismaMock.logEntry.create.mockResolvedValue({ id: "entry-1" } as never);

    await persistGroupedLog("proj-1", "railway", makeLog({ category: "info" }));

    expect(prismaMock.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triageStatus: "none" }) })
    );
    expect(triageLog).not.toHaveBeenCalled();
  });

  it("crée l'entrée avec triageStatus 'pending' et lance le triage pour un log critique", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    prismaMock.logEntry.create.mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(triageLog).mockResolvedValue({
      isRealIssue: false,
      finalCategory: "info",
      explanation: "Faux positif",
      fixLocation: "code",
      severityScore: 0,
    });

    await persistGroupedLog("proj-1", "railway", makeLog({ category: "critical" }));

    expect(prismaMock.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ triageStatus: "pending" }) })
    );

    await flushMicrotasks();
    expect(triageLog).toHaveBeenCalledWith({ level: "error", category: "critical", message: "boom" });
  });

  it("ne crée pas d'alerte ni de notification si le triage conclut à un faux positif", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    prismaMock.logEntry.create.mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(triageLog).mockResolvedValue({
      isRealIssue: false,
      finalCategory: "info",
      explanation: "Faux positif : requête invalide",
      fixLocation: "code",
      severityScore: 0,
    });

    await persistGroupedLog("proj-1", "railway", makeLog());
    await flushMicrotasks();

    expect(prismaMock.alert.create).not.toHaveBeenCalled();
    expect(sendAlertEmail).not.toHaveBeenCalled();
  });

  it("crée une alerte et notifie les destinataires si le triage confirme un vrai problème", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    prismaMock.logEntry.create.mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(triageLog).mockResolvedValue({
      isRealIssue: true,
      finalCategory: "critical",
      explanation: "Base de données injoignable",
      fixLocation: "operational",
      severityScore: 8,
    });
    prismaMock.alert.create.mockResolvedValue({ id: "alert-1" } as never);
    prismaMock.project.findUnique.mockResolvedValue({
      name: "Mon projet",
      userId: "user-1",
      organizationId: null,
      user: { email: "owner@example.com" },
    } as never);
    vi.mocked(listProjectRecipients).mockResolvedValue(["owner@example.com", "shared@example.com"]);

    await persistGroupedLog("proj-1", "railway", makeLog());
    await flushMicrotasks();

    expect(prismaMock.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          logEntryId: "entry-1",
          fixLocation: "operational",
          severityScore: 8,
        }),
      })
    );
    expect(sendAlertEmail).toHaveBeenCalledTimes(2);
    expect(prismaMock.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "alert-1" }, data: { emailSent: true, smsSent: false } })
    );
  });

  it("n'envoie pas de SMS si le quota du plan est épuisé, mais envoie toujours l'email", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    prismaMock.logEntry.create.mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(triageLog).mockResolvedValue({
      isRealIssue: true,
      finalCategory: "critical",
      explanation: "Panne",
      fixLocation: "operational",
      severityScore: 9,
    });
    prismaMock.alert.create.mockResolvedValue({ id: "alert-1" } as never);
    prismaMock.project.findUnique.mockResolvedValue({
      name: "Mon projet",
      userId: "user-1",
      organizationId: null,
      user: { email: "owner@example.com" },
    } as never);
    vi.mocked(listProjectRecipients).mockResolvedValue(["owner@example.com"]);
    vi.mocked(listProjectPhoneRecipients).mockResolvedValue(["+33600000000"]);
    vi.mocked(getSubscriptionForProject).mockResolvedValue({
      id: "sub-1",
      plan: "solo",
      smsUsedThisPeriod: 100,
      smsLimitWarningsSentThisPeriod: 2,
    } as never);
    vi.mocked(tryConsumeSmsQuota).mockResolvedValue(false);

    await persistGroupedLog("proj-1", "railway", makeLog());
    await flushMicrotasks();

    expect(sendAlertSms).not.toHaveBeenCalled();
    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailSent: true, smsSent: false } })
    );
  });

  it("envoie le SMS une seule fois par destinataire quand le quota est disponible", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    prismaMock.logEntry.create.mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(triageLog).mockResolvedValue({
      isRealIssue: true,
      finalCategory: "critical",
      explanation: "Panne",
      fixLocation: "operational",
      severityScore: 9,
    });
    prismaMock.alert.create.mockResolvedValue({ id: "alert-1" } as never);
    prismaMock.project.findUnique.mockResolvedValue({
      name: "Mon projet",
      userId: "user-1",
      organizationId: null,
      user: { email: "owner@example.com" },
    } as never);
    vi.mocked(listProjectRecipients).mockResolvedValue(["owner@example.com"]);
    vi.mocked(listProjectPhoneRecipients).mockResolvedValue(["+33600000000", "+33600000001"]);
    vi.mocked(getSubscriptionForProject).mockResolvedValue({
      id: "sub-1",
      plan: "solo",
      smsUsedThisPeriod: 0,
      smsLimitWarningsSentThisPeriod: 0,
    } as never);
    vi.mocked(tryConsumeSmsQuota).mockResolvedValue(true);

    await persistGroupedLog("proj-1", "railway", makeLog());
    await flushMicrotasks();

    expect(sendAlertSms).toHaveBeenCalledTimes(2);
    expect(prismaMock.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailSent: true, smsSent: true } })
    );
  });

  it("n'interroge pas le quota SMS s'il n'y a aucun destinataire avec téléphone", async () => {
    prismaMock.logEntry.findFirst.mockResolvedValue(null);
    prismaMock.logEntry.create.mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(triageLog).mockResolvedValue({
      isRealIssue: true,
      finalCategory: "critical",
      explanation: "Panne",
      fixLocation: "operational",
      severityScore: 9,
    });
    prismaMock.alert.create.mockResolvedValue({ id: "alert-1" } as never);
    prismaMock.project.findUnique.mockResolvedValue({
      name: "Mon projet",
      userId: "user-1",
      organizationId: null,
      user: { email: "owner@example.com" },
    } as never);
    vi.mocked(listProjectRecipients).mockResolvedValue(["owner@example.com"]);
    vi.mocked(listProjectPhoneRecipients).mockResolvedValue([]);

    await persistGroupedLog("proj-1", "railway", makeLog());
    await flushMicrotasks();

    expect(getSubscriptionForProject).not.toHaveBeenCalled();
    expect(sendAlertSms).not.toHaveBeenCalled();
  });
});
