// Regroupe les lignes de log consécutives d'un même "incident" (typiquement une stack
// trace découpée ligne par ligne par Railway) en un seul événement logique, avant stockage.
//
// Principe : les logs de niveau non-info (error/warn) d'un même projet, reçus dans une
// fenêtre de temps très courte, sont considérés comme faisant partie du même incident et
// fusionnés en un seul message multi-lignes. Un log de niveau "info" (requête HTTP normale
// par exemple) ferme immédiatement le groupe en cours, puisqu'il ne fait jamais partie
// d'une stack trace.
//
// Approche générique (basée sur le timing), pas sur la reconnaissance d'un format de stack
// trace précis — fonctionne quel que soit le langage/framework à l'origine des logs.

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
  level: string;
  firstTimestamp: Date;
  lastReceivedAt: number;
  timer: NodeJS.Timeout;
};

// Un groupe en cours de constitution par projet.
const pendingGroups = new Map<string, PendingGroup>();

function isGroupableLevel(level: string): boolean {
  const normalized = level.toLowerCase();
  return normalized.includes("err") || normalized.includes("warn");
}

// Traite un log entrant : soit il rejoint le groupe en cours pour ce projet, soit il le
// clôt et en ouvre un nouveau (ou est traité seul s'il est de niveau "info").
// `onFlush` est appelé avec le log fusionné dès que le groupe est prêt à être persisté.
export function processIncomingLog(projectId: string, log: IncomingLog, onFlush: (log: GroupedLog) => void) {
  const level = log.severity.toLowerCase();
  const existing = pendingGroups.get(projectId);

  if (!isGroupableLevel(level)) {
    // Un log "info" ferme tout groupe en cours (une stack trace ne contient jamais de info).
    if (existing) {
      flushGroup(projectId, onFlush);
    }
    onFlush(buildGroupedLog([log.message], level, new Date(log.timestamp)));
    return;
  }

  if (existing && existing.level === level) {
    // Même niveau, arrivé dans la fenêtre de regroupement : on l'ajoute au groupe en cours.
    clearTimeout(existing.timer);
    existing.lines.push(log.message);
    existing.lastReceivedAt = Date.now();
    existing.timer = scheduleFlush(projectId, onFlush);
    return;
  }

  // Niveau différent ou pas de groupe en cours : on clôt l'éventuel groupe précédent et
  // on en démarre un nouveau.
  if (existing) {
    flushGroup(projectId, onFlush);
  }

  pendingGroups.set(projectId, {
    lines: [log.message],
    level,
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

  onFlush(buildGroupedLog(group.lines, group.level, group.firstTimestamp));
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
