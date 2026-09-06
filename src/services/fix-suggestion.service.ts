import OpenAI from "openai";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../config/env";
import { getRepoTree, getFileContent, getFileContentRange } from "./github-repo-explorer.service";

const MAX_STEPS = 12;

export type FixSuggestion = {
  filePath: string;
  oldCode: string;
  newCode: string;
  explanation: string;
};

const SYSTEM_PROMPT = `Tu es un ingénieur logiciel qui corrige des bugs à partir d'un log d'erreur, dans un dépôt de code que tu dois explorer toi-même via les outils fournis (list_files, read_file, read_file_range).

Démarche :
1. Localise le ou les fichiers en cause, en commençant par ceux mentionnés explicitement dans le log (chemin de fichier dans une stack trace) s'il y en a. Lis-les avec read_file (fichier entier) par défaut : c'est le moyen le plus fiable de comprendre le contexte complet d'une fonction (imports, définitions utilisées, appelants) plutôt que de deviner une plage de lignes.
2. N'utilise read_file_range que si read_file refuse le fichier car trop volumineux, en ciblant alors une plage large (au moins 150-200 lignes) autour du numéro de ligne du log ou du nom de fonction concerné — jamais un extrait de quelques lignes qui ne montrerait pas la fonction en entier.
3. Une fois la cause identifiée avec certitude, propose un correctif minimal et ciblé : ne modifie que ce qui est nécessaire pour résoudre le problème décrit par le log, ne refactore pas au passage.
4. Appelle propose_fix avec : le chemin exact du fichier modifié, le code existant strictement tel qu'il apparaît dans le fichier (oldCode, incluant sa mise en forme d'origine, sans les numéros de ligne ajoutés par read_file_range), le code corrigé (newCode), et une explication brève de la correction.

Reste concentré sur l'erreur du log fourni au tout début — ne pars pas explorer des fichiers sans rapport avec elle. Ne relis jamais deux fois la même zone d'un fichier : si tu hésites après une lecture, élargis (list_files, ou une plage plus large) plutôt que de relire la même chose. N'appelle propose_fix qu'une fois sûr de la cause — si le log ne contient pas assez d'indices pour localiser un fichier précis même après exploration, utilise report_no_fix.`;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "Liste tous les chemins de fichiers et dossiers du dépôt.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lit le contenu complet d'un fichier du dépôt.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Chemin du fichier, tel que renvoyé par list_files." } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file_range",
      description: "Lit uniquement une plage de lignes d'un fichier, quelle que soit sa taille totale. À utiliser pour un fichier trop volumineux, ou pour cibler directement la zone signalée par une stack trace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
        },
        required: ["path", "startLine", "endLine"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_fix",
      description: "Propose le correctif final une fois la cause du problème localisée avec certitude.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          oldCode: { type: "string", description: "Code existant, strictement tel qu'il apparaît dans le fichier." },
          newCode: { type: "string", description: "Code corrigé, destiné à remplacer oldCode." },
          explanation: { type: "string", description: "Explication brève et claire de la correction." },
        },
        required: ["filePath", "oldCode", "newCode", "explanation"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_no_fix",
      description: "Signale qu'aucun correctif fiable ne peut être proposé à partir des éléments disponibles.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];

export async function suggestFix(params: {
  installationId: number;
  owner: string;
  repo: string;
  ref: string;
  logMessage: string;
}): Promise<FixSuggestion | null> {
  const { installationId, owner, repo, ref, logMessage } = params;
  const client = new OpenAI({ apiKey: env.openai.apiKey });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Log à corriger :\n\n${logMessage}` },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const completion = await client.chat.completions.create({
      model: env.openai.model,
      messages,
      tools: TOOLS,

      tool_choice: "auto",
    });

    const message = completion.choices[0]?.message;
    const toolCalls = message?.tool_calls;

    if (!message) {
      return null;
    }

    messages.push(message);

    if (!toolCalls || toolCalls.length === 0) {
      messages.push({
        role: "user",
        content: "Continue avec un appel d'outil : propose_fix si tu as identifié la cause avec certitude, report_no_fix sinon, ou list_files/read_file/read_file_range pour poursuivre l'exploration.",
      });
      continue;
    }

    let conclusion: FixSuggestion | null | undefined;

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") continue;

      const args = JSON.parse(toolCall.function.arguments || "{}");

      if (toolCall.function.name === "propose_fix") {
        conclusion = {
          filePath: args.filePath,
          oldCode: args.oldCode,
          newCode: args.newCode,
          explanation: args.explanation,
        };
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Correctif enregistré." });
        continue;
      }

      if (toolCall.function.name === "report_no_fix") {
        conclusion = null;
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Pris en compte." });
        continue;
      }

      if (toolCall.function.name === "list_files") {
        const tree = await getRepoTree(installationId, { owner, repo, ref });
        const paths = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ files: paths }) });
        continue;
      }

      if (toolCall.function.name === "read_file") {
        const result = await getFileContent(installationId, { owner, repo, path: args.path, ref });
        const payload = result.ok
          ? { path: result.path, content: result.content }
          : result.reason === "too_large"
            ? {
                path: result.path,
                error: "too_large",
                totalLines: result.totalLines,
                hint: "Ce fichier est trop volumineux pour être lu en entier. Utilise read_file_range pour cibler une plage de lignes précise.",
              }
            : { path: result.path, error: result.reason };
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(payload) });
        continue;
      }

      if (toolCall.function.name === "read_file_range") {
        const result = await getFileContentRange(installationId, {
          owner,
          repo,
          path: args.path,
          ref,
          startLine: args.startLine,
          endLine: args.endLine,
        });
        const payload = result.ok
          ? { path: result.path, startLine: result.startLine, endLine: result.endLine, totalLines: result.totalLines, content: result.content }
          : { path: result.path, error: result.reason };
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(payload) });
        continue;
      }

      messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Outil inconnu." });
    }

    if (conclusion !== undefined) {
      return conclusion;
    }

    messages.push({ role: "user", content: `Rappel — log à corriger :\n\n${logMessage}` });
  }

  return null;
}
