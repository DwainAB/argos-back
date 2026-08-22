// Script de test isolé : vérifie que le triage local (Ollama) distingue bien un vrai
// problème d'un faux positif, et produit une explication claire dans le premier cas.
// À lancer avec : npx tsx scripts/test-log-triage.ts

import "dotenv/config";
import { triageLog } from "../src/services/log-triage.service";

const CASES = [
  {
    label: "Vrai problème attendu (connexion DB perdue)",
    level: "error",
    category: "critical",
    message: "ECONNREFUSED: could not connect to database at db-prod:5432 — connection pool exhausted after 3 retries",
  },
  {
    label: "Faux positif attendu (erreur de validation utilisateur)",
    level: "error",
    category: "warning",
    message: "ValidationError: field 'email' is required — request rejected with 422 for POST /api/users",
  },
];

async function main() {
  for (const testCase of CASES) {
    console.log(`\n=== ${testCase.label} ===`);
    console.log(`Log : ${testCase.message}`);
    const result = await triageLog(testCase);
    console.log(`isRealIssue : ${result.isRealIssue}`);
    console.log(`Catégorie finale : ${result.finalCategory}`);
    console.log(`Explication : ${result.explanation}`);
  }
}

main().catch((err) => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
