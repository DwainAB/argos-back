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
