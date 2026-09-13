import OpenAI from "openai";
import { env } from "../config/env";

const SYSTEM_PROMPT = `Tu es un assistant qui explique des logs d'application backend en langage clair, à des personnes qui ne lisent pas forcément le code.

On te donne un log brut, avec son niveau. Rédige une explication courte (2-3 phrases) de ce que ce log signifie concrètement : ce qui s'est passé, dans quel contexte, et si c'est un signe normal ou préoccupant. Sans jargon inutile, sans supposition sur le code source que tu n'as pas vu.

L'explication doit toujours être rédigée en français, quelle que soit la langue du log source.

Réponds UNIQUEMENT avec le texte de l'explication, sans JSON, sans guillemets, sans préambule.`;

export async function explainLog(
  params: { level: string; message: string },
  onChunk?: (chunk: string) => void
): Promise<string> {
  const client = new OpenAI({ apiKey: env.groq.apiKey, baseURL: env.groq.baseUrl });

  const stream = await client.chat.completions.create({
    model: env.groq.model,
    stream: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Niveau : ${params.level}\nLog :\n\n${params.message}` },
    ],
  });

  let full = "";
  for await (const chunk of stream) {
    const piece = chunk.choices[0]?.delta?.content ?? "";
    if (piece) {
      full += piece;
      onChunk?.(piece);
    }
  }

  full = full.trim();
  if (!full) {
    throw new Error("Réponse de l'IA invalide ou vide.");
  }

  return full;
}
