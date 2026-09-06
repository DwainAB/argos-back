import { env } from "../config/env";

const SYSTEM_PROMPT = `Tu es un assistant qui explique des logs d'application backend en langage clair, à des personnes qui ne lisent pas forcément le code.

On te donne un log brut, avec son niveau. Rédige une explication courte (2-3 phrases) de ce que ce log signifie concrètement : ce qui s'est passé, dans quel contexte, et si c'est un signe normal ou préoccupant. Sans jargon inutile, sans supposition sur le code source que tu n'as pas vu.

Réponds UNIQUEMENT avec le texte de l'explication, sans JSON, sans guillemets, sans préambule.`;

export async function explainLog(
  params: { level: string; message: string },
  onChunk?: (chunk: string) => void
): Promise<string> {
  const response = await fetch(`${env.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.ollama.model,
      stream: true,
      keep_alive: "30m",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Niveau : ${params.level}\nLog :\n\n${params.message}` },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama a répondu avec le statut ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { message?: { content?: string } };
      const piece = parsed.message?.content ?? "";
      if (piece) {
        full += piece;
        onChunk?.(piece);
      }
    }
  }

  full = full.trim();
  if (!full) {
    throw new Error("Réponse de l'IA locale invalide ou vide.");
  }

  return full;
}
