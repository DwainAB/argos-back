// Script de backfill : applique les règles de classification (log-classifier.service.ts)
// aux logs déjà en base, créés avant l'introduction du champ "category".
// À lancer avec : npx tsx scripts/backfill-log-categories.ts

import { prisma } from "../src/lib/prisma";
import { classifyLog } from "../src/services/log-classifier.service";

async function main() {
  const logs = await prisma.logEntry.findMany();
  console.log(`${logs.length} log(s) à reclassifier...`);

  let updated = 0;
  for (const log of logs) {
    const category = classifyLog({ level: log.level, message: log.rawMessage });
    if (category !== log.category) {
      await prisma.logEntry.update({ where: { id: log.id }, data: { category } });
      updated++;
    }
  }

  console.log(`${updated} log(s) mis à jour.`);
}

main()
  .catch((err) => {
    console.error("Erreur pendant le backfill :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
