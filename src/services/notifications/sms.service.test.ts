import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({ env: { smsfactor: { apiToken: "test-token" } } }));

import { env } from "../../config/env";
import { sendAlertSms } from "./sms.service";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  (env as { smsfactor: { apiToken: string } }).smsfactor.apiToken = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sendAlertSms", () => {
  it("n'appelle pas l'API et logge une erreur si le token SMSFactor n'est pas configuré", async () => {
    (env as { smsfactor: { apiToken: string } }).smsfactor.apiToken = "";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendAlertSms({ to: "+33600000000", projectName: "Mon projet", severityScore: 8 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("SMSFACTOR_API_TOKEN"));
    consoleError.mockRestore();
  });

  it("envoie une requête GET à SMSFactor avec le destinataire, le sender et le message", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 1, message: "ok" }) });

    await sendAlertSms({ to: "+33600000000", projectName: "Mon projet", severityScore: 8 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("https://api.smsfactor.com/send?");
    expect(url).toContain("to=%2B33600000000");
    expect(url).toContain("sender=Argos");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(options.headers.Accept).toBe("application/json");
  });

  it("inclut le score de gravité et le nom du projet dans le message envoyé", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 1, message: "ok" }) });

    await sendAlertSms({ to: "+33600000000", projectName: "Mon projet", severityScore: 8 });

    const [url] = fetchMock.mock.calls[0];
    const text = new URL(url).searchParams.get("text");
    expect(text).toContain("niveau 8/10");
    expect(text).toContain("Mon projet");
  });

  it("logge une erreur si SMSFactor renvoie un statut d'échec, sans lever d'exception", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 0, message: "Crédit insuffisant" }) });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendAlertSms({ to: "+33600000000", projectName: "Mon projet", severityScore: 5 })
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Crédit insuffisant"));
    consoleError.mockRestore();
  });

  it("utilise 'Bonjour' le matin et 'Bonsoir' le soir (heure de Paris)", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 1, message: "ok" }) });
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-06-15T08:00:00.000Z")); // 10h en France (été, UTC+2)
    await sendAlertSms({ to: "+33600000000", projectName: "P", severityScore: 1 });
    let text = new URL(fetchMock.mock.calls[0][0]).searchParams.get("text");
    expect(text).toContain("Bonjour");

    fetchMock.mockClear();
    vi.setSystemTime(new Date("2026-06-15T19:00:00.000Z")); // 21h en France
    await sendAlertSms({ to: "+33600000000", projectName: "P", severityScore: 1 });
    text = new URL(fetchMock.mock.calls[0][0]).searchParams.get("text");
    expect(text).toContain("Bonsoir");
  });
});
