export type LogCategory = "critical" | "warning" | "benign" | "info";

const CRITICAL_PATTERNS: RegExp[] = [
  /econnrefused/i,
  /connection (to .* )?(refused|timed out|lost|terminated)/i,
  /out of memory/i,
  /\bfatal\b/i,
  /segmentation fault/i,
  /uncaught exception/i,
  /unhandled( promise)? rejection/i,
  /process (crashed|exited|killed)/i,
  /database (connection|pool) (failed|exhausted|timed out)/i,
  /enotfound/i,
  /econnreset/i,
  /\b5\d{2}\b.*internal server error/i,
];

const BENIGN_PATTERNS: RegExp[] = [
  /validation (failed|error)/i,
  /\b400\b.*bad request/i,
  /\b401\b.*unauthorized/i,
  /\b403\b.*forbidden/i,
  /\b404\b.*not found/i,
  /\b409\b.*conflict/i,
  /\b422\b.*unprocessable/i,
  /invalid (input|credentials|token|request)/i,
  /missing required field/i,
  /field .* is required/i,

  /unique( key)? violation/i,
  /duplicate key value violates unique constraint/i,
  /integrityerror/i,
  /foreign key constraint/i,
];

const WARNING_PATTERNS: RegExp[] = [
  /response time .* (exceeded|threshold)/i,
  /\bslow (query|request|response)\b/i,
  /deprecat(ed|ion)/i,
  /retry(ing)?/i,
  /rate limit/i,
  /memory usage (high|elevated)/i,
  /\b429\b.*too many requests/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyLog(params: { level: string; message: string }): LogCategory {
  const level = params.level.toLowerCase();
  const message = params.message;

  if (matchesAny(CRITICAL_PATTERNS, message)) {
    return "critical";
  }

  if (matchesAny(BENIGN_PATTERNS, message)) {
    return "benign";
  }

  if (matchesAny(WARNING_PATTERNS, message)) {
    return "warning";
  }

  if (level.includes("err")) {
    return "warning";
  }
  if (level.includes("warn")) {
    return "warning";
  }

  return "info";
}
