import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processIncomingLog } from "./log-grouper.service";

function makeLog(overrides: Partial<{ timestamp: string; message: string; severity: string }> = {}) {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    message: "boom",
    severity: "info",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("processIncomingLog", () => {
  it("transmet immédiatement une ligne non groupable (info sans mot-clé critique)", () => {
    const onFlush = vi.fn();
    processIncomingLog("proj-1", makeLog({ severity: "info", message: "Server listening on port 3000" }), onFlush);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(
      expect.objectContaining({ rawMessage: "Server listening on port 3000", level: "info" })
    );
  });

  it("regroupe des lignes d'erreur identiques reçues dans la fenêtre de groupage", () => {
    const onFlush = vi.fn();
    processIncomingLog("proj-2", makeLog({ severity: "error", message: "DB timeout attempt 1/8" }), onFlush);
    vi.advanceTimersByTime(100);
    processIncomingLog("proj-2", makeLog({ severity: "error", message: "DB timeout attempt 2/8" }), onFlush);

    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const flushed = onFlush.mock.calls[0][0];
    expect(flushed.rawMessage).toBe("DB timeout attempt 1/8\nDB timeout attempt 2/8");
    expect(flushed.level).toBe("error");
  });

  it("ignore les nombres lors de la comparaison pour regrouper des rafales avec compteur variable", () => {
    const onFlush = vi.fn();
    processIncomingLog("proj-3", makeLog({ severity: "warn", message: "retrying request 3/8" }), onFlush);
    processIncomingLog("proj-3", makeLog({ severity: "warn", message: "retrying request 4/8" }), onFlush);
    vi.advanceTimersByTime(500);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].rawMessage).toContain("retrying request 3/8");
    expect(onFlush.mock.calls[0][0].rawMessage).toContain("retrying request 4/8");
  });

  it("clôture le groupe en cours et en ouvre un nouveau si le message change", () => {
    const onFlush = vi.fn();
    processIncomingLog("proj-4", makeLog({ severity: "error", message: "DB timeout" }), onFlush);
    processIncomingLog("proj-4", makeLog({ severity: "error", message: "Redis timeout" }), onFlush);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].rawMessage).toBe("DB timeout");

    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0].rawMessage).toBe("Redis timeout");
  });

  it("rattache une frame de stack trace au groupe en cours plutôt que de la comparer par contenu", () => {
    const onFlush = vi.fn();
    processIncomingLog("proj-5", makeLog({ severity: "error", message: "Unhandled promise rejection" }), onFlush);
    processIncomingLog(
      "proj-5",
      makeLog({ severity: "info", message: "    at maFonction (fichier.js:12:34)" }),
      onFlush
    );
    vi.advanceTimersByTime(500);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].rawMessage).toBe(
      "Unhandled promise rejection\n    at maFonction (fichier.js:12:34)"
    );
  });

  it("retient le niveau le plus sévère du groupe à la clôture", () => {
    const onFlush = vi.fn();
    processIncomingLog("proj-6", makeLog({ severity: "warn", message: "retrying" }), onFlush);
    processIncomingLog("proj-6", makeLog({ severity: "error", message: "retrying" }), onFlush);
    vi.advanceTimersByTime(500);

    expect(onFlush.mock.calls[0][0].level).toBe("error");
  });

  it("gère indépendamment les groupes de projets différents", () => {
    const onFlush = vi.fn();
    processIncomingLog("proj-a", makeLog({ severity: "error", message: "boom A" }), onFlush);
    processIncomingLog("proj-b", makeLog({ severity: "error", message: "boom B" }), onFlush);
    vi.advanceTimersByTime(500);

    expect(onFlush).toHaveBeenCalledTimes(2);
    const messages = onFlush.mock.calls.map((call) => call[0].rawMessage);
    expect(messages).toContain("boom A");
    expect(messages).toContain("boom B");
  });
});
