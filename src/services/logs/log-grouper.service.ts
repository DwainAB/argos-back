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

function isGroupableLevel(level: string): boolean {
  const normalized = level.toLowerCase();
  return normalized.includes("err") || normalized.includes("warn");
}

// Compare le contenu plutôt que le niveau annoncé par le fournisseur : certains fournisseurs
// (observé avec Render) classent une même ligne répétée tantôt "warning" tantôt "error" d'un
// appel à l'autre — comparer sur le niveau casserait alors le groupe à chaque alternance, en
// dispersant une seule rafale en plusieurs alertes. Les nombres sont ignorés (ex: "attempt
// 3/8") pour que des lignes identiques hors compteur restent regroupées.
function normalizeForComparison(message: string): string {
  return message.replace(/\d+/g, "#").trim();
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

  if (!isGroupableLevel(level)) {
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
