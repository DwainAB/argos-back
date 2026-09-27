import { classifyLog, type LogCategory } from "./log-classifier.service";

const GROUPING_WINDOW_MS = 500;

type IncomingLog = {
  timestamp: string;
  message: string;
  severity: string;
};

export type GroupedLog = {
  rawMessage: string;
  level: string;
  category: LogCategory;
  externalTimestamp: Date;
};

type PendingGroup = {
  lines: string[];
  levels: Set<string>;
  normalizedMessage: string;
  firstTimestamp: Date;
  lastReceivedAt: number;
  timer: NodeJS.Timeout;
};

const pendingGroups = new Map<string, PendingGroup>();

// Décide si une ligne doit passer par la fenêtre de groupage, avant de connaître le
// regroupement final : se base sur le niveau brut de la source ET sur la classification par
// contenu de cette seule ligne — certaines sources (observé avec Render) renvoient "info" pour
// des lignes stderr pourtant clairement critiques (stack trace, TypeError...), qui doivent
// être groupées comme n'importe quelle rafale d'erreurs, pas envoyées une par une.
function isGroupableLevel(level: string, message: string): boolean {
  const normalized = level.toLowerCase();
  if (normalized.includes("err") || normalized.includes("warn")) return true;

  const category = classifyLog({ level, message });
  return category === "critical" || category === "warning";
}

// Compare le contenu plutôt que le niveau annoncé par le fournisseur : certains fournisseurs
// (observé avec Render) classent une même ligne répétée tantôt "warning" tantôt "error" d'un
// appel à l'autre — comparer sur le niveau casserait alors le groupe à chaque alternance, en
// dispersant une seule rafale en plusieurs alertes. Les nombres sont ignorés (ex: "attempt
// 3/8") pour que des lignes identiques hors compteur restent regroupées.
function normalizeForComparison(message: string): string {
  return message.replace(/\d+/g, "#").trim();
}

// Forme caractéristique d'une frame de stack trace Node ("    at maFonction
// (fichier.js:12:34)"). Certaines sources (observé avec Render) envoient chaque ligne d'un
// console.error(err.stack) multi-lignes comme un message WebSocket séparé — chaque frame étant
// différente de la précédente (fichier/fonction différents), normalizeForComparison ne les
// reconnaît jamais comme le "même" message, ce qui disperserait une seule exception en une
// alerte par frame. Une frame rejoint donc toujours le groupe en cours du même projet, plutôt
// que d'être comparée par contenu : elle ne peut par nature qu'appartenir à l'erreur juste
// au-dessus d'elle, jamais démarrer un incident à elle seule.
// Couvre les deux formes que V8 produit : "at maFonction (fichier.js:12:34)" (appel nommé) et
// "at fichier.js:12:34" (appel anonyme au niveau module, sans parenthèses).
const STACK_TRACE_FRAME_PATTERN = /^\s*at (.+\(.*:\d+:\d+\)|.*:\d+:\d+)$/;

function isStackTraceFrame(message: string): boolean {
  return STACK_TRACE_FRAME_PATTERN.test(message);
}

// Le niveau le plus sévère du groupe est retenu à la clôture, plutôt que le premier ou le
// dernier reçu — cohérent avec le fait qu'une seule vraie erreur dans la rafale doit suffire à
// classer tout le groupe comme tel.
function mostSevereLevel(levels: Set<string>): string {
  for (const level of levels) {
    if (level.toLowerCase().includes("err")) return level;
  }
  return levels.values().next().value ?? "info";
}

export function processIncomingLog(projectId: string, log: IncomingLog, onFlush: (log: GroupedLog) => void) {
  const level = log.severity.toLowerCase();
  const existing = pendingGroups.get(projectId);

  // Une frame de stack trace seule (ex: "    at jsonParser (...)") ne contient par nature
  // aucun mot-clé "critique" — isGroupableLevel la classerait donc "info" et la ferait sortir
  // du groupage avant même d'être reconnue comme une frame. Elle doit rejoindre le groupe en
  // cours en priorité sur ce test, tant qu'un groupe est ouvert pour ce projet.
  if (existing && isStackTraceFrame(log.message)) {
    clearTimeout(existing.timer);
    existing.lines.push(log.message);
    existing.levels.add(level);
    existing.lastReceivedAt = Date.now();
    existing.timer = scheduleFlush(projectId, onFlush);
    return;
  }

  if (!isGroupableLevel(level, log.message)) {
    if (existing) {
      flushGroup(projectId, onFlush);
    }
    onFlush(buildGroupedLog([log.message], level, new Date(log.timestamp)));
    return;
  }

  const normalizedMessage = normalizeForComparison(log.message);

  if (existing && existing.normalizedMessage === normalizedMessage) {
    clearTimeout(existing.timer);
    existing.lines.push(log.message);
    existing.levels.add(level);
    existing.lastReceivedAt = Date.now();
    existing.timer = scheduleFlush(projectId, onFlush);
    return;
  }

  if (existing) {
    flushGroup(projectId, onFlush);
  }

  pendingGroups.set(projectId, {
    lines: [log.message],
    levels: new Set([level]),
    normalizedMessage,
    firstTimestamp: new Date(log.timestamp),
    lastReceivedAt: Date.now(),
    timer: scheduleFlush(projectId, onFlush),
  });
}

function scheduleFlush(projectId: string, onFlush: (log: GroupedLog) => void): NodeJS.Timeout {
  return setTimeout(() => flushGroup(projectId, onFlush), GROUPING_WINDOW_MS);
}

function flushGroup(projectId: string, onFlush: (log: GroupedLog) => void) {
  const group = pendingGroups.get(projectId);
  if (!group) return;

  clearTimeout(group.timer);
  pendingGroups.delete(projectId);

  onFlush(buildGroupedLog(group.lines, mostSevereLevel(group.levels), group.firstTimestamp));
}

function buildGroupedLog(lines: string[], level: string, externalTimestamp: Date): GroupedLog {
  const rawMessage = lines.join("\n");
  return {
    rawMessage,
    level,
    category: classifyLog({ level, message: rawMessage }),
    externalTimestamp,
  };
}
