// Classification des logs par règles simples — premier filtre rapide et gratuit, avant
// tout appel à l'IA. Objectif : ne pas envoyer chaque ligne de log à Ollama, seulement
// les cas ambigus qu'on ne sait pas trancher ici (voir TODO plus bas pour la suite).
//
// Catégories :
//   - critical : le service plante ou perd une ressource vitale (DB, mémoire, connexion réseau).
//   - warning  : dégradation de performance ou signal à surveiller, sans panne.
//   - benign   : erreur normale côté utilisateur (validation, requête malformée) — pas une alerte.
//   - info     : rien à signaler.

export type LogCategory = "critical" | "warning" | "benign" | "info";

// Motifs indiquant un crash ou une perte de ressource vitale — priorité la plus haute.
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

// Motifs d'erreurs "normales" côté utilisateur — pas une alerte à remonter.
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
  // Violations de contrainte DB déclenchées par une donnée utilisateur (doublon, clé déjà
  // existante...) — un comportement applicatif normal, pas une panne de la base elle-même.
  /unique( key)? violation/i,
  /duplicate key value violates unique constraint/i,
  /integrityerror/i,
  /foreign key constraint/i,
];

// Motifs d'avertissement — signal à surveiller, sans panne.
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

// Classe un log à partir de son niveau brut (fourni par Railway) et de son message.
// Le niveau brut sert de première indication, mais le contenu du message peut le nuancer
// (ex: un "error" de validation est du niveau error mais reste "benign" pour nous).
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

  // Pas de pattern reconnu : on retombe sur le niveau brut fourni par Railway.
  if (level.includes("err")) {
    // Une erreur non reconnue par nos règles est traitée comme un avertissement plutôt
    // qu'une alerte critique, par prudence — évite les faux positifs bruyants.
    // TODO : envoyer ce cas ambigu à l'IA (Ollama) pour affiner la classification,
    // au lieu de la laisser par défaut sur "warning".
    return "warning";
  }
  if (level.includes("warn")) {
    return "warning";
  }

  return "info";
}
