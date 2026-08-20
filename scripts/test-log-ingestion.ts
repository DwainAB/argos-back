// Script de test isolé : vérifie le flux complet d'ingestion d'un log critique — création
// du LogEntry, triage par l'IA locale, création de l'Alerte si confirmé — sans dépendre
// d'une connexion Railway réelle. À lancer avec : npx tsx scripts/test-log-ingestion.ts
//
// Utilise le premier projet en base disponible.

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { persistGroupedLog } from "../src/services/railway-log-stream.service";
import { classifyLog } from "../src/services/log-classifier.service";

const FAKE_MESSAGE = "ECONNREFUSED: could not connect to database at db-prod:5432 — connection pool exhausted";

async function main() {
  const project = await prisma.project.findFirst();
  if (!project) {
    console.error("Aucun projet en base.");
    process.exit(1);
  }

  console.log(`Projet : ${project.name}`);
  console.log(`Log simulé : ${FAKE_MESSAGE}\n`);

  const category = classifyLog({ level: "error", message: FAKE_MESSAGE });
  console.log(`Catégorie (règles) : ${category}`);

  await persistGroupedLog(project.id, {
    rawMessage: FAKE_MESSAGE,
    level: "error",
    category,
    externalTimestamp: new Date(),
  });

  console.log("\nLogEntry créé. Attente du triage IA (asynchrone, quelques secondes)...");

  // Le triage tourne en tâche de fond (fire-and-forget) : on attend un peu avant de
  // vérifier le résultat, plutôt que de le récupérer de façon synchrone.
  await new Promise((resolve) => setTimeout(resolve, 40_000));

  const logEntry = await prisma.logEntry.findFirst({
    where: { projectId: project.id, rawMessage: FAKE_MESSAGE },
    orderBy: { createdAt: "desc" },
    include: { alert: true },
  });

  console.log(`\naiSummary : ${logEntry?.aiSummary ?? "(vide)"}`);
  console.log(`Alerte créée : ${logEntry?.alert ? "oui" : "non"}`);
  if (logEntry?.alert) {
    console.log(`  - explanation : ${logEntry.alert.explanation}`);
    console.log(`  - status : ${logEntry.alert.status}`);
  }
}

main()
  .catch((err) => {
    console.error("Erreur inattendue :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
