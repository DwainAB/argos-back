import { env } from "../../config/env";

const SPOTHIT_ENDPOINT = "https://www.spot-hit.fr/api/envoyer/sms";

// Mention de désinscription imposée par la CNIL pour tout SMS marketing/notification en
// France (voir doc.spot-hit.fr/api/envoyer.html) — sans elle, Spot-Hit rejette l'envoi.
const STOP_MENTION = "STOP au 36200";

type SpothitResponse = { resultat: 1; id: string } | { resultat: 0; erreurs: string };

async function send(params: { to: string; body: string }) {
  if (!env.spothit.apiKey) {
    console.error("Spot-Hit n'est pas configuré (SPOTHIT_API_KEY manquant) — SMS non envoyé.");
    return;
  }

  const body = new URLSearchParams({
    key: env.spothit.apiKey,
    message: `${params.body} ${STOP_MENTION}`,
    destinataires: params.to,
  });

  const response = await fetch(SPOTHIT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const result = (await response.json()) as SpothitResponse;

  if (result.resultat === 0) {
    console.error(`Échec de l'envoi SMS via Spot-Hit (code erreur ${result.erreurs}).`);
  }
}

export function sendAlertSms(params: { to: string; projectName: string; level: string; explanation: string }) {
  const levelLabel = params.level === "critical" ? "Erreur critique" : "Avertissement";

  return send({
    to: params.to,
    body: `Argos AI — [${params.projectName}] ${levelLabel} détecté : ${params.explanation}`,
  });
}
