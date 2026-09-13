import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";

const client = new OAuth2Client(env.google.oauthClientId);

export type GoogleProfile = {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
};

export class GoogleAuthError extends Error {}

// Vérifie la signature et l'audience (client_id) de l'id_token émis par Google Identity
// Services côté navigateur (bouton "Continuer avec Google" du login, flux 100% front, sans
// client_secret) — indispensable ici puisque le token transite par le client avant de nous
// arriver, contrairement à un échange de code fait directement serveur-à-serveur.
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  let ticket;
  try {
    ticket = await client.verifyIdToken({ idToken, audience: env.google.oauthClientId });
  } catch {
    throw new GoogleAuthError("Jeton Google invalide.");
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new GoogleAuthError("Jeton Google invalide.");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    firstName: payload.given_name ?? "",
    lastName: payload.family_name ?? "",
  };
}
