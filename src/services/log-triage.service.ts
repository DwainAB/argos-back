import { env } from "../config/env";

export type LogTriageResult = {
  isRealIssue: boolean;
  finalCategory: "info" | "warning" | "critical";
  explanation: string;
};

const SYSTEM_PROMPT = `Tu es un assistant qui aide à trier des logs d'application backend pour une équipe technique.

On te donne un log déjà classé comme "critical" ou "warning" par un premier filtre à base de règles. Ce premier classement est volontairement prudent et peut se tromper : ta tâche est de le corriger si besoin. Concrètement :
1. Confirmer s'il s'agit réellement d'un problème côté application/infrastructure à remonter à l'équipe technique (isRealIssue: true), ou d'un faux positif à ignorer (isRealIssue: false). Est un faux positif : une erreur causée par une requête ou une donnée invalide envoyée par un utilisateur (validation, champ manquant, entrée malformée, 4xx) — l'application a correctement fait son travail en la rejetant, il n'y a rien à corriger côté code ni à remonter à l'équipe. Est un vrai problème : un bug, une panne, une ressource indisponible, une dégradation — tout ce qui indique que l'application elle-même dysfonctionne.
2. Choisir la catégorie finale du log (finalCategory), qui remplace le classement initial : "info" si ce n'est qu'une information sans aucune action à prévoir (typiquement un faux positif anodin) ; "warning" si ça mérite qu'on y prête attention mais que ce n'est pas encore critique ; "critical" si c'est une panne ou un dysfonctionnement grave. Un faux positif n'est pas toujours "info" : une erreur utilisateur inhabituellement fréquente peut rester un "warning" à surveiller, à toi d'en juger.
3. Si c'est un vrai problème, rédiger une explication courte et claire, compréhensible par quelqu'un qui ne lit pas le code, décrivant ce qui s'est probablement passé et sa gravité.

Réponds UNIQUEMENT avec un objet JSON de la forme :
{"isRealIssue": true ou false, "finalCategory": "info" ou "warning" ou "critical", "explanation": "..."}

Si isRealIssue est false, "explanation" indique brièvement pourquoi ce n'est pas un problème réel. Si isRealIssue est true, "explanation" est le texte destiné à l'équipe (2-4 phrases, sans jargon inutile, sans supposition sur le code source que tu n'as pas vu).`;

export async function triageLog(params: { level: string; category: string; message: string }): Promise<LogTriageResult> {
  const response = await fetch(`${env.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.ollama.model,
      format: "json",
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Niveau brut : ${params.level}\nCatégorie (règles) : ${params.category}\nLog :\n\n${params.message}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama a répondu avec le statut ${response.status}`);
  }

  const data = (await response.json()) as { message?: { content?: string } };
  const raw = data.message?.content ?? "";

  try {
    const parsed = JSON.parse(raw);
    const finalCategory = parsed?.finalCategory;
    if (
      typeof parsed?.isRealIssue === "boolean" &&
      typeof parsed?.explanation === "string" &&
      (finalCategory === "info" || finalCategory === "warning" || finalCategory === "critical")
    ) {
      return { isRealIssue: parsed.isRealIssue, finalCategory, explanation: parsed.explanation };
    }
  } catch {
  }

  return {
    isRealIssue: true,
    finalCategory: params.category === "critical" ? "critical" : "warning",
    explanation: "Impossible d'obtenir une explication fiable de l'IA locale pour ce log ; à vérifier manuellement.",
  };
}
