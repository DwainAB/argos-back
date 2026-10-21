import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({ env: { encryptionKey: "" } }));

import { env } from "../config/env";
import { decryptSecret, encryptSecret } from "./encryption";

// Clé de 32 octets valide encodée en base64 (44 caractères), générée pour les tests uniquement.
const VALID_KEY_BASE64 = "YmFzZTY0LWtleS1kZS10ZXN0LWRlLTMyLW9jdGV0cyE=";
const VALID_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

beforeEach(() => {
  (env as { encryptionKey: string }).encryptionKey = VALID_KEY_BASE64;
});

describe("encryptSecret / decryptSecret", () => {
  it("chiffre puis déchiffre un texte en retrouvant la valeur d'origine", () => {
    const plainText = "clé-api-tres-secrete-123";
    const encrypted = encryptSecret(plainText);

    expect(encrypted).not.toBe(plainText);
    expect(decryptSecret(encrypted)).toBe(plainText);
  });

  it("produit un résultat différent à chaque appel (IV aléatoire)", () => {
    const plainText = "meme-secret";
    const first = encryptSecret(plainText);
    const second = encryptSecret(plainText);

    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(plainText);
    expect(decryptSecret(second)).toBe(plainText);
  });

  it("accepte une clé encodée en hex (64 caractères)", () => {
    (env as { encryptionKey: string }).encryptionKey = VALID_KEY_HEX;
    const plainText = "secret-avec-cle-hex";

    expect(decryptSecret(encryptSecret(plainText))).toBe(plainText);
  });

  it("lève une erreur si ENCRYPTION_KEY est absente", () => {
    (env as { encryptionKey: string }).encryptionKey = "";
    expect(() => encryptSecret("x")).toThrow("ENCRYPTION_KEY absente");
  });

  it("lève une erreur si ENCRYPTION_KEY ne fait pas 32 octets", () => {
    (env as { encryptionKey: string }).encryptionKey = "dHJvcC1jb3VydA=="; // "trop-court" en base64
    expect(() => encryptSecret("x")).toThrow("ENCRYPTION_KEY invalide");
  });

  it("échoue au déchiffrement si les données ont été altérées (tag d'authentification invalide)", () => {
    const encrypted = encryptSecret("donnee-integre");
    const tampered = Buffer.from(encrypted, "base64");
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decryptSecret(tampered.toString("base64"))).toThrow();
  });
});
