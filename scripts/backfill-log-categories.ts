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
