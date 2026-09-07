import twilio from "twilio";
import { env } from "../config/env";

const client = env.twilio.accountSid && env.twilio.authToken ? twilio(env.twilio.accountSid, env.twilio.authToken) : null;

// Compte Twilio en mode trial (aucune carte ajoutée) : l'API refuse tout texte libre et
// n'accepte que l'un de ses templates prédéfinis, au contenu générique fixe (ex:
// "sms_internal_alerts" -> "Alert: System downtime detected..."), impossible à
// personnaliser avec le vrai texte de l'alerte. À retirer (et cette variable d'env) une
// fois le compte passé en payant (console.twilio.com > Billing > Upgrade) — le texte réel
// de l'alerte, déjà construit ci-dessous, partira alors normalement.
const TRIAL_TEMPLATE_BODY = "sms_internal_alerts";

async function send(params: { to: string; body: string }) {
  if (!client) {
    console.error("Twilio n'est pas configuré (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN manquants) — SMS non envoyé.");
    return;
  }

  await client.messages.create({
    to: params.to,
    from: env.twilio.fromPhoneNumber,
    body: env.twilio.trialMode ? TRIAL_TEMPLATE_BODY : params.body,
  });
}

export function sendAlertSms(params: { to: string; projectName: string; level: string; explanation: string }) {
  const levelLabel = params.level === "critical" ? "Erreur critique" : "Avertissement";

  return send({
    to: params.to,
    body: `Argos AI — [${params.projectName}] ${levelLabel} détecté : ${params.explanation}`,
  });
}
