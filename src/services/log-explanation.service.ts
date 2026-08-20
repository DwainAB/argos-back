// Explication à la demande d'un log par l'IA locale (Ollama) : contrairement au triage
// (log-triage.service.ts, qui juge si un log critical/warning est un vrai problème), ce
// service se contente de vulgariser un log quelconque — quel que soit son niveau — pour
// quelqu'un qui ne lit pas forcément le code. Déclenché au clic sur un log dans
// l'interface, pas automatiquement à l'ingestion.

import { env } from "../config/env";

const SYSTEM_PROMPT = `Tu es un assistant qui explique des logs d'application backend en langage clair, à des personnes qui ne lisent pas forcément le code.

On te donne un log brut, avec son niveau. Rédige une explication courte (2-3 phrases) de ce que ce log signifie concrètement : ce qui s'est passé, dans quel contexte, et si c'est un signe normal ou préoccupant. Sans jargon inutile, sans supposition sur le code source que tu n'as pas vu.

Réponds UNIQUEMENT avec un objet JSON de la forme :
{"explanation": "..."}`;

// Interroge Ollama pour expliquer un log quelconque, à la demande. Un seul appel, contraint
// au format JSON — pas de boucle, pas d'accès au code source.
export async function explainLog(params: { level: string; message: string }): Promise<string> {
  const response = await fetch(`${env.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.ollama.model,
      format: "json",
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Niveau : ${params.level}\nLog :\n\n${params.message}` },
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
    if (typeof parsed?.explanation === "string") {
      return parsed.explanation;
    }
  } catch {
    // Réponse non exploitable : traité ci-dessous.
  }

  throw new Error("Réponse de l'IA locale invalide ou vide.");
}
