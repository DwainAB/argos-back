import OpenAI from "openai";
import { env } from "../../config/env";

export type LogTriageResult = {
  isRealIssue: boolean;
  finalCategory: "info" | "warning" | "critical";
  explanation: string;
  // Voir Alert.fixLocation (schema.prisma) : n'a de sens que si isRealIssue est true. Détermine
  // si le bouton "Demander une correction IA" est proposé (uniquement pour "code") — voir
  // alerts.route.ts et JOURNAL.md.
  fixLocation: "code" | "operational" | "external";
};

const SYSTEM_PROMPT = `Tu es un assistant qui aide à trier des logs d'application backend pour une équipe technique.

On te donne un log déjà classé comme "critical" ou "warning" par un premier filtre à base de règles. Ce premier classement est volontairement prudent et peut se tromper : ta tâche est de le corriger si besoin. Concrètement :
1. Confirmer s'il s'agit réellement d'un problème côté application/infrastructure à remonter à l'équipe technique (isRealIssue: true), ou d'un faux positif à ignorer (isRealIssue: false). Est un faux positif : une erreur causée par une requête ou une donnée invalide envoyée par un utilisateur (validation, champ manquant, entrée malformée, 4xx) — l'application a correctement fait son travail en la rejetant, il n'y a rien à corriger côté code ni à remonter à l'équipe. Est un vrai problème : un bug, une panne, une ressource indisponible, une dégradation — tout ce qui indique que l'application elle-même dysfonctionne.
2. Choisir la catégorie finale du log (finalCategory), qui remplace le classement initial : "info" si ce n'est qu'une information sans aucune action à prévoir (typiquement un faux positif anodin) ; "warning" si ça mérite qu'on y prête attention mais que ce n'est pas encore critique ; "critical" si c'est une panne ou un dysfonctionnement grave. Un faux positif n'est pas toujours "info" : une erreur utilisateur inhabituellement fréquente peut rester un "warning" à surveiller, à toi d'en juger.
3. Si c'est un vrai problème (isRealIssue: true), déterminer où se situe la correction (fixLocation) — le critère décisif est : une modification du code source de l'application pourrait-elle raisonnablement résoudre ce problème précis ?
   - "code" : un bug applicatif corrigible en modifiant le code source (logique erronée, exception non gérée, mauvais appel, validation manquante, etc.) — la cause est dans ce que l'équipe a écrit, pas dans l'état d'une ressource externe.
   - "operational" : une panne ou un incident d'infrastructure propre à l'équipe, mais que changer du code ne résout pas — la ressource elle-même est en cause (base de données indisponible, serveur inaccessible, réseau interne coupé, disque plein, service interne down). L'équipe doit investiguer/redémarrer/reconfigurer sa propre infrastructure, pas modifier le code applicatif.
   - "external" : seul cas où rien côté équipe applicative ne peut résoudre le problème — il faut se rendre sur l'espace client/compte d'un fournisseur tiers pour agir (recharger un crédit, changer de plan, renouveler quelque chose, mettre à jour une configuration chez ce tiers). Exemples stricts : quota ou crédit épuisé/proche de l'épuisement chez un fournisseur facturé à l'usage (API IA type OpenAI/Groq, SMS type Twilio, email type Resend, hébergeur), certificat TLS expiré à renouveler chez l'autorité de certification, domaine/DNS mal configuré chez le registrar, limite du plan d'abonnement d'un service tiers atteinte, clé API révoquée ou expirée nécessitant d'en régénérer une dans la console du fournisseur.
   Ne classe JAMAIS en "external" une panne de connectivité vers une ressource que l'application possède elle-même (sa propre base de données, son propre serveur) — c'est "operational", même si le symptôme ressemble à un problème réseau.
4. Rédiger l'explication (explanation) selon fixLocation :
   - "code" : description courte et claire de ce qui s'est probablement passé et de sa gravité, compréhensible par quelqu'un qui ne lit pas le code — sans indiquer de correctif précis, seulement la nature du problème.
   - "operational" : description courte de l'incident d'infrastructure et de son impact, puis ce que l'équipe doit vérifier/faire sur son propre système (ex: "La base de données de l'application est injoignable, ce qui empêche toute requête d'aboutir. Vérifiez la disponibilité du serveur de base de données et son réseau interne, et redémarrez-le si nécessaire."). Jamais de suggestion de modifier du code dans ce cas.
   - "external" : instructions concrètes à suivre, à la deuxième personne, disant précisément où aller et quoi faire (ex: "Vous approchez de la limite de votre quota OpenAI. Rendez-vous sur platform.openai.com pour ajouter des crédits avant d'atteindre la limite, sous peine de blocage des requêtes IA."). Jamais de suggestion de modifier du code dans ce cas.

L'explication doit toujours être rédigée en français, quelle que soit la langue du log source.

Réponds UNIQUEMENT avec un objet JSON de la forme :
{"isRealIssue": true ou false, "finalCategory": "info" ou "warning" ou "critical", "fixLocation": "code" ou "operational" ou "external", "explanation": "..."}

Si isRealIssue est false, fixLocation vaut "code" par défaut (sans effet, aucune alerte n'étant créée pour un faux positif) et "explanation" indique brièvement pourquoi ce n'est pas un problème réel. Si isRealIssue est true, "explanation" suit la règle du point 4 ci-dessus selon fixLocation (2-4 phrases, sans jargon inutile, sans supposition sur le code source que tu n'as pas vu).`;

export async function triageLog(params: { level: string; category: string; message: string }): Promise<LogTriageResult> {
  const client = new OpenAI({ apiKey: env.groq.apiKey, baseURL: env.groq.baseUrl });

  try {
    const completion = await client.chat.completions.create({
      model: env.groq.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Niveau brut : ${params.level}\nCatégorie (règles) : ${params.category}\nLog :\n\n${params.message}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw);
    const finalCategory = parsed?.finalCategory;
    const fixLocation =
      parsed?.fixLocation === "external" || parsed?.fixLocation === "operational" ? parsed.fixLocation : "code";

    if (
      typeof parsed?.isRealIssue === "boolean" &&
      typeof parsed?.explanation === "string" &&
      (finalCategory === "info" || finalCategory === "warning" || finalCategory === "critical")
    ) {
      return { isRealIssue: parsed.isRealIssue, finalCategory, explanation: parsed.explanation, fixLocation };
    }
  } catch {
    // Réponse Groq invalide, vide, ou requête échouée : repli prudent ci-dessous plutôt que
    // de propager l'erreur — un triage manqué ne doit jamais bloquer l'ingestion du log.
  }

  return {
    isRealIssue: true,
    finalCategory: params.category === "critical" ? "critical" : "warning",
    explanation: "Impossible d'obtenir une explication fiable de l'IA pour ce log ; à vérifier manuellement.",
    fixLocation: "code",
  };
}
