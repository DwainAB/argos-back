import { env } from "../../config/env";

const SMSFACTOR_ENDPOINT = "https://api.smsfactor.com/send";

const SENDER_ID = "Argos";

type SmsfactorResponse = { status: number; message: string };

async function send(params: { to: string; body: string }) {
  if (!env.smsfactor.apiToken) {
    console.error("SMSFactor n'est pas configuré (SMSFACTOR_API_TOKEN manquant) — SMS non envoyé.");
    return;
  }

  const query = new URLSearchParams({ text: params.body, to: params.to, sender: SENDER_ID });

  const response = await fetch(`${SMSFACTOR_ENDPOINT}?${query}`, {
    headers: {
      Authorization: `Bearer ${env.smsfactor.apiToken}`,
      Accept: "application/json",
    },
  });

  const result = (await response.json()) as SmsfactorResponse;

  if (result.status !== 1) {
    console.error(`Échec de l'envoi SMS via SMSFactor (${result.message}).`);
  }
}

function greeting(now: Date): "Bonjour" | "Bonsoir" {
  const hour = Number(
    new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).format(now)
  );
  return hour < 12 ? "Bonjour" : "Bonsoir";
}

function formatDateTime(now: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

export function sendAlertSms(params: { to: string; projectName: string; severityScore: number }) {
  const now = new Date();

  return send({
    to: params.to,
    body: `${greeting(now)}, une alerte de niveau ${params.severityScore}/10 a été détectée sur le projet ${params.projectName} le ${formatDateTime(now)}.`,
  });
}
