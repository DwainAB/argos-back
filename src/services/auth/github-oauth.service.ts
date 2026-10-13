import { env } from "../../config/env";

// Flow OAuth "user-to-server" d'une GitHub App (pas une OAuth App classique) : le paramètre
// scope de /login/oauth/authorize est ignoré pour ce type d'app, les permissions viennent de
// la config de la GitHub App elle-même (voir github.com/settings/apps/<slug> > Permissions >
// Account permissions > Email addresses, doit être en lecture pour /user/emails ci-dessous).
// Distinct du flow d'installation (buildGithubInstallUrl, github-app.service.ts) : ici on
// authentifie l'utilisateur pour se connecter à Argos AI, pas pour installer l'app sur un repo.
export function buildGithubAuthorizeUrl(state: string) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.github.clientId);
  url.searchParams.set("redirect_uri", env.github.loginRedirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

type GithubTokenResponse = { access_token: string; token_type: string } | { error: string; error_description: string };

export async function exchangeGithubCodeForToken(code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.github.clientId,
      client_secret: env.github.clientSecret,
      code,
      redirect_uri: env.github.loginRedirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Échec de l'échange du code OAuth GitHub (${response.status}).`);
  }

  const data = (await response.json()) as GithubTokenResponse;
  if ("error" in data) {
    throw new Error(`Échec de l'échange du code OAuth GitHub : ${data.error_description || data.error}`);
  }

  return data.access_token;
}

export type GithubProfile = { id: number; login: string; email: string | null };

// L'email du profil /user est souvent null (préférence de confidentialité GitHub) même si
// l'utilisateur en a un vérifié : /user/emails (nécessite la permission "Email addresses" sur
// la GitHub App) renvoie la liste complète, dont on prend l'adresse marquée "primary".
export async function fetchGithubProfile(accessToken: string): Promise<GithubProfile> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" };

  const userResponse = await fetch("https://api.github.com/user", { headers });
  if (!userResponse.ok) {
    throw new Error(`Échec de la récupération du profil GitHub (${userResponse.status}).`);
  }
  const user = (await userResponse.json()) as { id: number; login: string; email: string | null };

  let email = user.email;
  if (!email) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as { email: string; primary: boolean; verified: boolean }[];
      console.log(`GitHub /user/emails pour ${user.login} :`, JSON.stringify(emails));
      email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
    } else {
      console.error(`Échec de GitHub /user/emails pour ${user.login} : ${emailsResponse.status} ${await emailsResponse.text()}`);
    }
  }

  return { id: user.id, login: user.login, email };
}
