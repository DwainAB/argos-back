import { beforeEach, describe, expect, it, vi } from "vitest";

const createCompletion = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createCompletion } };
  },
}));

import { triageLog } from "./log-triage.service";

function mockGroqResponse(content: string) {
  createCompletion.mockResolvedValue({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  createCompletion.mockReset();
});

describe("triageLog", () => {
  it("retourne le triage de l'IA quand la réponse est valide et complète", async () => {
    mockGroqResponse(
      JSON.stringify({
        isRealIssue: true,
        finalCategory: "critical",
        fixLocation: "operational",
        severityScore: 8,
        explanation: "La base de données est injoignable.",
      })
    );

    const result = await triageLog({ level: "error", category: "critical", message: "ECONNREFUSED" });

    expect(result).toEqual({
      isRealIssue: true,
      finalCategory: "critical",
      fixLocation: "operational",
      severityScore: 8,
      explanation: "La base de données est injoignable.",
    });
  });

  it("ramène fixLocation à 'code' si l'IA renvoie une valeur hors énumération", async () => {
    mockGroqResponse(
      JSON.stringify({
        isRealIssue: true,
        finalCategory: "critical",
        fixLocation: "n'importe quoi",
        severityScore: 7,
        explanation: "Bug applicatif.",
      })
    );

    const result = await triageLog({ level: "error", category: "critical", message: "TypeError" });

    expect(result.fixLocation).toBe("code");
  });

  it("borne severityScore entre 0 et 10", async () => {
    mockGroqResponse(
      JSON.stringify({
        isRealIssue: true,
        finalCategory: "critical",
        fixLocation: "code",
        severityScore: 42,
        explanation: "Bug.",
      })
    );

    const result = await triageLog({ level: "error", category: "critical", message: "boom" });

    expect(result.severityScore).toBe(10);
  });

  it("ramène severityScore à 0 si la valeur n'est pas un entier", async () => {
    mockGroqResponse(
      JSON.stringify({
        isRealIssue: true,
        finalCategory: "warning",
        fixLocation: "code",
        severityScore: "élevé",
        explanation: "Bug.",
      })
    );

    const result = await triageLog({ level: "warn", category: "warning", message: "boom" });

    expect(result.severityScore).toBe(0);
  });

  it("applique le repli prudent si le JSON de l'IA est invalide", async () => {
    mockGroqResponse("ceci n'est pas du JSON");

    const result = await triageLog({ level: "error", category: "critical", message: "boom" });

    expect(result).toEqual({
      isRealIssue: true,
      finalCategory: "critical",
      explanation: "Impossible d'obtenir une explication fiable de l'IA pour ce log ; à vérifier manuellement.",
      fixLocation: "code",
      severityScore: 8,
    });
  });

  it("applique le repli prudent avec severityScore réduit si la catégorie initiale est 'warning'", async () => {
    mockGroqResponse("pas du JSON");

    const result = await triageLog({ level: "warn", category: "warning", message: "boom" });

    expect(result.finalCategory).toBe("warning");
    expect(result.severityScore).toBe(4);
  });

  it("applique le repli prudent si l'appel à l'IA échoue", async () => {
    createCompletion.mockRejectedValue(new Error("Groq indisponible"));

    const result = await triageLog({ level: "error", category: "critical", message: "boom" });

    expect(result.isRealIssue).toBe(true);
    expect(result.finalCategory).toBe("critical");
  });

  it("applique le repli prudent si des champs requis sont manquants dans la réponse", async () => {
    mockGroqResponse(JSON.stringify({ isRealIssue: true }));

    const result = await triageLog({ level: "error", category: "critical", message: "boom" });

    expect(result.explanation).toBe(
      "Impossible d'obtenir une explication fiable de l'IA pour ce log ; à vérifier manuellement."
    );
  });

  it("applique le repli prudent si la réponse de l'IA est vide", async () => {
    createCompletion.mockResolvedValue({ choices: [] });

    const result = await triageLog({ level: "error", category: "critical", message: "boom" });

    expect(result.fixLocation).toBe("code");
    expect(result.isRealIssue).toBe(true);
  });
});
