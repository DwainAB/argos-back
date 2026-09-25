// Détection de secrets exposés par expressions régulières, en complément de l'analyse IA
// (code-analysis.service.ts). Contrairement à l'IA, ce scan est 100% déterministe et gratuit :
// deux analyses successives du même fichier trouvent toujours exactement les mêmes secrets.
// L'IA reste utile pour les cas non standards (mot de passe en dur, token maison) que ces
// patterns connus ne couvrent pas — les deux résultats sont fusionnés, jamais l'un à la place
// de l'autre, précisément parce qu'un faux négatif sur un secret est la pire erreur possible ici.

export type SecretPatternMatch = {
  label: string;
  line: number;
  // Extrait masqué (jamais le secret en clair dans nos logs/rapports/notifications).
  preview: string;
};

const SECRET_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "Clé d'accès AWS", regex: /AKIA[0-9A-Z]{16}/g },
  { label: "Clé API Google", regex: /AIza[0-9A-Za-z_-]{35}/g },
  { label: "Clé Stripe (live)", regex: /sk_live_[0-9A-Za-z]{16,}/g },
  { label: "Clé Stripe (test)", regex: /sk_test_[0-9A-Za-z]{16,}/g },
  { label: "Token GitHub (personal access token)", regex: /ghp_[0-9A-Za-z]{36}/g },
  { label: "Token GitHub (fine-grained)", regex: /github_pat_[0-9A-Za-z_]{22,}/g },
  { label: "Token Slack", regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { label: "Clé privée (PEM)", regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { label: "Clé API Resend", regex: /re_[0-9A-Za-z_]{16,}/g },
  { label: "Clé API Twilio", regex: /SK[0-9a-f]{32}/g },
  { label: "Clé API OpenAI", regex: /sk-[0-9A-Za-z]{20,}/g },
  { label: "Clé API Groq", regex: /gsk_[0-9A-Za-z]{20,}/g },
  {
    // Motif générique de repli : une variable au nom évocateur (API_KEY, SECRET, PASSWORD,
    // TOKEN...) assignée à une valeur non vide qui n'est ni un placeholder ni une référence
    // à une variable d'environnement — couvre les secrets sans format de préfixe connu.
    label: "Secret générique en dur",
    regex:
      /(?:api[_-]?key|secret|password|token|passwd)\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
  },
];

const PLACEHOLDER_PATTERN = /^(your|change[_-]?me|example|placeholder|xxx+|todo|<.*>|\$\{.*\}|process\.env)/i;

function maskSecret(value: string): string {
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

export function scanForSecrets(content: string): SecretPatternMatch[] {
  const lines = content.split("\n");
  const matches: SecretPatternMatch[] = [];

  lines.forEach((line, index) => {
    // Valeurs déjà signalées sur cette ligne par un pattern spécifique (AWS, Stripe, ...) :
    // le pattern générique de repli, exécuté en dernier, ne doit pas les resignaler en double.
    const alreadyMatchedOnLine = new Set<string>();

    for (const { label, regex } of SECRET_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        const value = match[1] ?? match[0];
        if (PLACEHOLDER_PATTERN.test(value)) continue;
        if (alreadyMatchedOnLine.has(value)) continue;

        alreadyMatchedOnLine.add(value);
        matches.push({ label, line: index + 1, preview: maskSecret(value) });
      }
    }
  });

  return matches;
}
