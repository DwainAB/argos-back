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

const pendingGroups = new Map<string, PendingGroup>();

function isGroupableLevel(level: string): boolean {
  const normalized = level.toLowerCase();
  return normalized.includes("err") || normalized.includes("warn");
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

  if (existing && existing.level === level) {
    clearTimeout(existing.timer);
    existing.lines.push(log.message);
    existing.lastReceivedAt = Date.now();
    existing.timer = scheduleFlush(projectId, onFlush);
    return;
  }

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
