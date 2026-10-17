import { describe, expect, it } from "vitest";
import { scanForSecrets } from "./secret-patterns";

describe("scanForSecrets", () => {
  it("détecte une clé d'accès AWS", () => {
    const matches = scanForSecrets("const key = 'AKIAIOSFODNN7EXAMPLE';");
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("Clé d'accès AWS");
    expect(matches[0].line).toBe(1);
  });

  it("détecte une clé Stripe live mais pas une clé de test confondue", () => {
    const matches = scanForSecrets("sk_live_abcdefghijklmnop1234");
    expect(matches.map((m) => m.label)).toEqual(["Clé Stripe (live)"]);
  });

  it("détecte un token GitHub personal access token", () => {
    const token = "ghp_" + "a".repeat(36);
    const matches = scanForSecrets(token);
    expect(matches.map((m) => m.label)).toContain("Token GitHub (personal access token)");
  });

  it("détecte une clé privée PEM", () => {
    const matches = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIB...");
    expect(matches.map((m) => m.label)).toContain("Clé privée (PEM)");
  });

  it("détecte un secret générique en dur assigné à une variable évocatrice", () => {
    const matches = scanForSecrets('const password = "sup3rSecretValue123";');
    expect(matches.map((m) => m.label)).toContain("Secret générique en dur");
  });

  it("ignore les placeholders évidents", () => {
    expect(scanForSecrets('API_KEY="your_api_key_here_123"')).toHaveLength(0);
    expect(scanForSecrets('TOKEN="change_me_please_1234"')).toHaveLength(0);
    expect(scanForSecrets('SECRET="${process.env.SECRET_VALUE}"')).toHaveLength(0);
  });

  it("ignore les références à des variables d'environnement", () => {
    expect(scanForSecrets('password = process.env.DB_PASSWORD_LONG_VALUE')).toHaveLength(0);
  });

  it("ne signale pas deux fois la même valeur déjà matchée par un pattern spécifique", () => {
    const matches = scanForSecrets("const key = 'AKIAIOSFODNN7EXAMPLE';");
    expect(matches).toHaveLength(1);
  });

  it("masque la valeur détectée dans le preview, jamais en clair", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const matches = scanForSecrets(secret);
    expect(matches[0].preview).not.toBe(secret);
    expect(matches[0].preview).toContain("•");
    expect(matches[0].preview.startsWith(secret.slice(0, 4))).toBe(true);
    expect(matches[0].preview.endsWith(secret.slice(-4))).toBe(true);
  });

  it("reporte le bon numéro de ligne sur un contenu multi-lignes", () => {
    const content = ["const a = 1;", "const b = 2;", "const key = 'AKIAIOSFODNN7EXAMPLE';"].join("\n");
    const matches = scanForSecrets(content);
    expect(matches[0].line).toBe(3);
  });

  it("ne détecte rien dans du code sans secret", () => {
    expect(scanForSecrets("function add(a, b) { return a + b; }")).toHaveLength(0);
  });
});
