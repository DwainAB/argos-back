import crypto from "node:crypto";
import { env } from "../config/env";

// Chiffrement symétrique des secrets sensibles stockés en base (clés API tierces, ex:
// Render) — jamais utilisé pour les mots de passe utilisateur (voir auth.service.ts,
// bcrypt, irréversible par conception). AES-256-GCM : IV aléatoire à chaque appel (jamais
// réutilisé), tag d'authentification vérifié au déchiffrement — toute donnée altérée en
// base fait échouer decrypt() plutôt que de renvoyer un résultat corrompu silencieusement.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  if (!env.encryptionKey) {
    throw new Error(
      "ENCRYPTION_KEY absente : impossible de chiffrer/déchiffrer un secret. Générez-en une (`openssl rand -base64 32`) et renseignez-la dans .env."
    );
  }

  const key = Buffer.from(env.encryptionKey, env.encryptionKey.length === 44 ? "base64" : "hex");

  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY invalide : doit représenter exactement 32 octets (256 bits).");
  }

  return key;
}

// Résultat encodé en un seul champ texte : IV (12) + tag GCM (16) + texte chiffré, le tout
// en base64 — simple à stocker dans une colonne unique sans schéma composite.
export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = raw.subarray(IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
