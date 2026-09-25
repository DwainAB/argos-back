import "dotenv/config";
import { triageLog } from "../src/services/logs/log-triage.service";

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
  {
    label: "Vrai problème attendu, fixLocation=external (quota OpenAI proche de l'épuisement)",
    level: "warn",
    category: "warning",
    message: "OpenAI API warning: You have used 90% of your monthly quota. Requests may be rejected once the limit is reached.",
  },
  {
    label: "Vrai problème attendu, fixLocation=external (quota OpenAI dépassé)",
    level: "error",
    category: "critical",
    message: "OpenAI API error 429: You exceeded your current quota, please check your plan and billing details.",
  },
];

async function main() {
  for (const testCase of CASES) {
    console.log(`\n=== ${testCase.label} ===`);
    console.log(`Log : ${testCase.message}`);
    const result = await triageLog(testCase);
    console.log(`isRealIssue : ${result.isRealIssue}`);
    console.log(`Catégorie finale : ${result.finalCategory}`);
    console.log(`fixLocation : ${result.fixLocation}`);
    console.log(`Explication : ${result.explanation}`);
  }
}

main().catch((err) => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
