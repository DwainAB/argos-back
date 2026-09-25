import crypto from "node:crypto";
import OpenAI from "openai";
import { env } from "../../config/env";
import { getRepoTree, getFileContent, type RepoTreeEntry } from "../github/github-repo-explorer.service";
import { scanForSecrets } from "../logs/secret-patterns";

// Extensions considérées comme du code source à analyser — le reste (images, fonts, fichiers
// de verrouillage, etc.) n'apporte rien à une revue de perf/sécurité/architecture.
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".java", ".php", ".rs", ".c", ".cpp", ".h",
  ".prisma", ".sql", ".yml", ".yaml", ".json", ".env.example",
]);

// Dossiers systématiquement ignorés, même s'ils contiennent des fichiers aux extensions
// ci-dessus (dépendances installées, builds générés, jamais du code écrit par l'équipe).
const IGNORED_DIR_SEGMENTS = ["node_modules", "dist", "build", ".next", "vendor", ".git", "coverage"];

const MAX_FILES_ANALYZED = 300; // garde-fou sur un repo anormalement volumineux
// OpenAI (gpt-4.1, comme fix-suggestion.service.ts) plutôt que Groq : Groq testé en
// conditions réelles s'est avéré peu fiable sur cette charge (tier gratuit limité à 8000
// tokens/minute par compte, 429 en rafale même à faible concurrence) — voir JOURNAL.md.
// Les limites de rate OpenAI sont nettement plus généreuses, d'où une concurrence plus
// élevée ici, cohérente avec le reste du pipeline IA du projet.
const MAX_CONCURRENT_ANALYSES = 8;
const MAX_RETRIES_PER_FILE = 3;
const SECONDS_PER_FILE_ESTIMATE = 1.5; // temps moyen observé en conditions réelles
const MAX_CHARS_PER_FILE = 80000; // ~20 000 tokens, garde-fou sur un fichier anormalement volumineux

export type CodeAnalysisEstimate = {
  filesToAnalyze: number;
  estimatedSeconds: number;
};

function isAnalyzableFile(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => IGNORED_DIR_SEGMENTS.includes(segment))) return false;

  const dotIndex = path.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const extension = path.slice(dotIndex);
  return CODE_EXTENSIONS.has(extension);
}

async function listAnalyzableFiles(
  installationId: number,
  params: { owner: string; repo: string; ref: string }
): Promise<RepoTreeEntry[]> {
  const tree = await getRepoTree(installationId, params);
  return tree.filter((entry) => entry.type === "blob" && isAnalyzableFile(entry.path)).slice(0, MAX_FILES_ANALYZED);
}

// Estimation légère : ne lit que l'arbre Git (chemins + tailles), jamais le contenu des
// fichiers — rapide et gratuite, à l'inverse de l'analyse réelle ci-dessous.
export async function estimateCodeAnalysis(
  installationId: number,
  params: { owner: string; repo: string; ref: string }
): Promise<CodeAnalysisEstimate> {
  const files = await listAnalyzableFiles(installationId, params);
  const parallelBatches = Math.ceil(files.length / MAX_CONCURRENT_ANALYSES);

  return {
    filesToAnalyze: files.length,
    estimatedSeconds: Math.max(5, Math.round(parallelBatches * SECONDS_PER_FILE_ESTIMATE) + 10), // +10s pour la synthèse finale
  };
}

export type FindingSeverity = "critical" | "warning" | "info";
export type FindingCategory =
  | "security"
  | "secrets"
  | "performance"
  | "architecture"
  | "dependencies"
  | "dead_code"
  | "error_handling"
  | "tests";

export type FindingStatus = "open" | "resolved" | "ignored";

export type FindingResolvedBy = {
  userId: string;
  firstName: string;
  lastName: string;
};

export type CodeFinding = {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  filePath: string;
  title: string;
  description: string;
  recommendation: string;
  status: FindingStatus;
  resolvedBy: FindingResolvedBy | null;
  resolvedAt: string | null;
};

export type CodeAnalysisScores = Record<
  "security" | "performance" | "architecture" | "maintainability",
  number // 0-10, 10 = aucun problème notable
>;

export type CodeAnalysisResult = {
  filesScanned: number;
  scores: CodeAnalysisScores;
  findings: CodeFinding[];
};

const FILE_ANALYSIS_SYSTEM_PROMPT = `Tu es un ingénieur logiciel senior qui fait une revue de code automatisée sur un seul fichier, dans le cadre d'un audit plus large d'un dépôt.

Analyse le fichier fourni selon ces catégories, uniquement si tu trouves un problème réel et concret (jamais de remarque générique ou de style personnel) :
- "secrets" : UNIQUEMENT une vraie valeur de clé API, mot de passe ou token, non vide, visible en clair dans le code ou un commentaire (ex. \`api_key = "sk-abc123..."\`). Sévérité toujours "critical". Ne classe JAMAIS en "secrets" une simple déclaration de champ destinée à recevoir un secret sans valeur réelle qui y soit assignée (ex. \`api_key: str = ""\`, \`api_key: str\` sans valeur, \`process.env.API_KEY\`, un champ de configuration Pydantic/dotenv/os.environ sans valeur littérale) — ceci est une pratique normale et attendue, pas un secret exposé.
- "security" : faille de sécurité (injection, absence de validation d'entrée, mauvaise gestion d'authentification/autorisation, désérialisation non sûre, etc.). Une déclaration de champ sensible sans valeur par défaut sûre (ex. valeur par défaut vide au lieu de lever une erreur si absente) relève de "security", pas de "secrets" — ce n'est qu'une bonne pratique à améliorer, pas une fuite.
- "performance" : boucle ou requête inefficace, N+1, opération bloquante évitable, fuite mémoire probable.
- "architecture" : mauvaise séparation des responsabilités, couplage excessif, duplication structurelle importante.
- "dependencies" : usage d'une API dépréciée ou d'un pattern connu pour être problématique dans une lib utilisée.
- "dead_code" : code manifestement mort (jamais appelé, condition toujours fausse) ou dupliqué dans ce même fichier.
- "error_handling" : erreur silencieusement avalée (catch vide), promesse non gérée, absence de gestion d'erreur sur une opération qui peut échouer.
- "tests" : ne signale ceci QUE si le fichier est un fichier de test manifestement incomplet (ex. test vide, assertions absentes) — ne signale jamais l'absence de test pour un fichier qui n'en est pas un, ça sera évalué globalement ailleurs.

Sois strict : un fichier propre ne doit renvoyer aucun finding. Ne remonte que des problèmes que tu peux justifier précisément avec ce qui est écrit dans le fichier. Toutes les descriptions et recommandations doivent être rédigées en français.

Si une liste de "problèmes précédemment détectés sur ce fichier" t'est fournie, vérifie pour chacun s'il est TOUJOURS présent dans la version actuelle du fichier ou s'il a été corrigé. Ne les recopie jamais dans "findings" (qui ne contient que les problèmes NOUVEAUX, jamais vus avant) — réponds ce statut séparément dans "previousFindingsStatus".

Réponds UNIQUEMENT avec un objet JSON de la forme :
{"findings": [{"category": "...", "severity": "critical|warning|info", "title": "...", "description": "...", "recommendation": "..."}], "previousFindingsStatus": [{"id": "...", "stillPresent": true ou false}]}

Si aucun problème précédent n'était fourni, renvoie "previousFindingsStatus": [].`;

// Filet de sécurité pour un 429/5xx transitoire malgré le retry déjà intégré au SDK OpenAI —
// respecte le header retry-after quand il est présent plutôt qu'un délai fixe.
async function callWithRetry<T>(call: () => Promise<T>, attemptsLeft = MAX_RETRIES_PER_FILE): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const isRateLimit = typeof err === "object" && err !== null && (err as { status?: number }).status === 429;
    if (!isRateLimit || attemptsLeft <= 0) throw err;

    const retryAfterHeader = (err as { headers?: Record<string, string> }).headers?.["retry-after"];
    const waitSeconds = retryAfterHeader ? Number(retryAfterHeader) : 5;
    await new Promise((resolve) => setTimeout(resolve, (Number.isFinite(waitSeconds) ? waitSeconds : 5) * 1000));

    return callWithRetry(call, attemptsLeft - 1);
  }
}

type FileAnalysisResult = {
  newFindings: Omit<CodeFinding, "filePath">[];
  // Map id de l'ancien finding -> toujours présent (true) ou corrigé (false). Un ancien
  // finding absent de cette map (ex. réponse IA incomplète) est traité prudemment comme
  // toujours présent ailleurs dans le pipeline — on ne referme jamais un problème par défaut.
  previousFindingsStatus: Map<string, boolean>;
};

async function analyzeFile(
  client: OpenAI,
  file: { path: string; content: string },
  previousFindings: CodeFinding[] = []
): Promise<FileAnalysisResult> {
  const empty: FileAnalysisResult = { newFindings: [], previousFindingsStatus: new Map() };

  try {
    const previousFindingsPrompt =
      previousFindings.length > 0
        ? `\n\nProblèmes précédemment détectés sur ce fichier, à revérifier :\n${JSON.stringify(
            previousFindings.map((f) => ({ id: f.id, title: f.title, description: f.description }))
          )}`
        : "";

    const completion = await callWithRetry(() =>
      client.chat.completions.create({
        model: env.openai.model,
        // temperature: 0 pour minimiser la variabilité d'une exécution à l'autre sur un même
        // fichier — sans l'éliminer totalement (aucun LLM n'est parfaitement déterministe),
        // mais réduit fortement le risque qu'un même secret soit détecté puis "oublié" au
        // hasard d'un nouvel appel. Voir aussi scanForSecrets, filet de sécurité déterministe
        // indépendant du modèle pour les formats de secret connus.
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: FILE_ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: `Fichier : ${file.path}\n\n${file.content}${previousFindingsPrompt}` },
        ],
      })
    );

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");

    const newFindings: Omit<CodeFinding, "filePath">[] = Array.isArray(parsed?.findings)
      ? parsed.findings.filter(
          (f: unknown): f is Omit<CodeFinding, "filePath"> =>
            typeof f === "object" &&
            f !== null &&
            typeof (f as CodeFinding).category === "string" &&
            typeof (f as CodeFinding).severity === "string" &&
            typeof (f as CodeFinding).title === "string"
        )
      : [];

    const previousFindingsStatus = new Map<string, boolean>();
    if (Array.isArray(parsed?.previousFindingsStatus)) {
      for (const entry of parsed.previousFindingsStatus) {
        if (typeof entry?.id === "string" && typeof entry?.stillPresent === "boolean") {
          previousFindingsStatus.set(entry.id, entry.stillPresent);
        }
      }
    }

    return { newFindings, previousFindingsStatus };
  } catch (err) {
    console.error(`Erreur d'analyse IA du fichier ${file.path} :`, err);
    return empty;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const SYNTHESIS_SYSTEM_PROMPT = `Tu reçois la liste brute des problèmes détectés fichier par fichier lors d'un audit de dépôt de code. Ta tâche : attribuer un score de 0 à 10 (10 = excellent, aucun souci) pour chacune de ces quatre dimensions globales du dépôt : "security", "performance", "architecture", "maintainability" (qui couvre dependencies/dead_code/error_handling/tests). Base-toi sur le nombre et la gravité des findings dans chaque dimension — beaucoup de "critical" doit fortement abaisser le score concerné, une poignée de "info" isolés ne doit presque pas le faire baisser. Un dépôt sans aucun finding dans une dimension mérite 10 sur cette dimension.

Réponds UNIQUEMENT avec un objet JSON de la forme :
{"scores": {"security": 0-10, "performance": 0-10, "architecture": 0-10, "maintainability": 0-10}}`;

async function synthesizeScores(client: OpenAI, findings: CodeFinding[]): Promise<CodeAnalysisScores> {
  const fallback: CodeAnalysisScores = { security: 10, performance: 10, architecture: 10, maintainability: 10 };
  if (findings.length === 0) return fallback;

  try {
    const completion = await callWithRetry(() =>
      client.chat.completions.create({
        model: env.openai.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(findings) },
        ],
      })
    );

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const scores = parsed?.scores;
    if (
      typeof scores?.security === "number" &&
      typeof scores?.performance === "number" &&
      typeof scores?.architecture === "number" &&
      typeof scores?.maintainability === "number"
    ) {
      return scores;
    }
  } catch (err) {
    console.error("Erreur lors de la synthèse des scores d'analyse de code :", err);
  }

  return fallback;
}

export async function runCodeAnalysis(
  installationId: number,
  params: { owner: string; repo: string; ref: string },
  // Findings de la dernière analyse "done" du projet, s'il y en a une. Seuls les findings
  // encore "open" sont utiles ici : ceux déjà marqués corrigé/ignoré par un utilisateur ne
  // sont jamais revérifiés (le statut manuel prime, voir JOURNAL.md) ni recopiés.
  previousOpenFindings: CodeFinding[] = []
): Promise<CodeAnalysisResult> {
  const client = new OpenAI({ apiKey: env.openai.apiKey });
  const files = await listAnalyzableFiles(installationId, params);

  const previousByFile = new Map<string, CodeFinding[]>();
  for (const finding of previousOpenFindings) {
    const list = previousByFile.get(finding.filePath) ?? [];
    list.push(finding);
    previousByFile.set(finding.filePath, list);
  }

  const perFileFindings = await mapWithConcurrency(files, MAX_CONCURRENT_ANALYSES, async (entry) => {
    const result = await getFileContent(installationId, { owner: params.owner, repo: params.repo, path: entry.path, ref: params.ref });
    if (!result.ok) return [];

    // Tronque les fichiers anormalement volumineux (garde-fou de coût/contexte) pour l'IA
    // uniquement : mieux vaut une analyse partielle par l'IA (le début du fichier) que pas
    // d'analyse du tout. Le scan par regex ci-dessous porte lui sur le fichier COMPLET, non
    // tronqué — un secret situé après la coupure doit rester détecté.
    const content =
      result.content.length > MAX_CHARS_PER_FILE
        ? `${result.content.slice(0, MAX_CHARS_PER_FILE)}\n\n[... fichier tronqué, ${result.content.length - MAX_CHARS_PER_FILE} caractères supplémentaires non montrés ...]`
        : result.content;

    const previousForFile = previousByFile.get(entry.path) ?? [];
    const { newFindings: aiFindings, previousFindingsStatus } = await analyzeFile(client, { path: entry.path, content }, previousForFile);

    // Un ancien finding reste tel quel (même id, donc son historique/statut) s'il est confirmé
    // toujours présent, ou en l'absence de confirmation explicite — jamais refermé par défaut,
    // un faux négatif sur une confirmation de correction est sans conséquence (le problème
    // reste juste signalé une analyse de plus), l'inverse serait risqué.
    const stillOpenPreviousFindings = previousForFile.filter((f) => previousFindingsStatus.get(f.id) !== false);

    // Détection déterministe des formats de secret connus, en complément de l'IA (voir
    // secret-patterns.ts) : ne dépend d'aucun modèle, donc jamais de faux négatif aléatoire
    // sur un secret déjà repéré par une exécution précédente.
    const patternMatches = scanForSecrets(result.content);
    const patternFindings: Omit<CodeFinding, "filePath">[] = patternMatches.map((m) => ({
      id: crypto.randomUUID(),
      category: "secrets",
      severity: "critical",
      title: `${m.label} détectée (ligne ${m.line})`,
      description: `Un secret correspondant au format "${m.label}" a été trouvé en clair dans ce fichier : ${m.preview}.`,
      recommendation: "Révoquer immédiatement cette clé/ce token auprès du fournisseur concerné, la retirer du code, et la déplacer dans une variable d'environnement non versionnée.",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    }));

    // Un même secret peut être trouvé par l'IA ET par une regex — on ne garde le finding IA
    // que s'il ne fait pas doublon avec un pattern déjà détecté sur ce fichier, pour éviter
    // d'afficher deux fois le même problème.
    const aiSecretsAlreadyCovered = patternFindings.length > 0;
    const dedupedAiFindings = aiFindings.filter((f) => f.category !== "secrets" || !aiSecretsAlreadyCovered);

    const newFindingsWithIds = dedupedAiFindings.map(
      (f) =>
        ({
          ...f,
          id: crypto.randomUUID(),
          filePath: entry.path,
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
        }) as CodeFinding
    );

    const newPatternFindings = patternFindings.map((f) => ({ ...f, filePath: entry.path }) as CodeFinding);

    return [...stillOpenPreviousFindings, ...newPatternFindings, ...newFindingsWithIds];
  });

  const findings = perFileFindings.flat();
  const scores = await synthesizeScores(client, findings);

  return { filesScanned: files.length, scores, findings };
}
