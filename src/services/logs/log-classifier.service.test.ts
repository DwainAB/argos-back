import { describe, expect, it } from "vitest";
import { classifyLog } from "./log-classifier.service";

describe("classifyLog", () => {
  it("classe une erreur de connexion refusée comme critique", () => {
    expect(classifyLog({ level: "info", message: "connect ECONNREFUSED 127.0.0.1:5432" })).toBe(
      "critical"
    );
  });

  it("classe une exception non interceptée comme critique", () => {
    expect(classifyLog({ level: "info", message: "Unhandled promise rejection" })).toBe("critical");
  });

  it("classe un TypeError levé dans le code comme critique même sans mot-clé explicite", () => {
    expect(
      classifyLog({ level: "info", message: "TypeError: Cannot read properties of undefined" })
    ).toBe("critical");
  });

  it("classe une frame de stack trace Node comme critique", () => {
    expect(classifyLog({ level: "info", message: "    at maFonction (fichier.js:12:34)" })).toBe(
      "critical"
    );
  });

  it("classe une erreur 404 comme bénigne", () => {
    expect(classifyLog({ level: "error", message: "404 Not Found: /api/users/42" })).toBe("benign");
  });

  it("classe une violation de contrainte unique comme bénigne", () => {
    expect(
      classifyLog({ level: "error", message: "duplicate key value violates unique constraint" })
    ).toBe("benign");
  });

  it("classe une dépréciation comme avertissement", () => {
    expect(classifyLog({ level: "info", message: "Deprecation warning: this API will be removed" })).toBe(
      "warning"
    );
  });

  it("classe une limite de débit comme avertissement", () => {
    expect(classifyLog({ level: "info", message: "429 Too Many Requests" })).toBe("warning");
  });

  it("retombe sur critique quand le level brut est 'error' sans pattern reconnu", () => {
    expect(classifyLog({ level: "error", message: "Something odd happened" })).toBe("critical");
  });

  it("retombe sur avertissement quand le level brut est 'warn' sans pattern reconnu", () => {
    expect(classifyLog({ level: "warn", message: "Something odd happened" })).toBe("warning");
  });

  it("classe un message neutre sans pattern ni level particulier comme info", () => {
    expect(classifyLog({ level: "info", message: "Server listening on port 3000" })).toBe("info");
  });

  it("priorise les patterns critiques sur les patterns bénins si les deux matchent", () => {
    expect(
      classifyLog({ level: "info", message: "ECONNREFUSED while handling 404 Not Found" })
    ).toBe("critical");
  });
});
