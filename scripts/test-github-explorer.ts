// Script de test isolé : vérifie qu'on peut bien lire l'arborescence puis le contenu
// d'un fichier d'un repo GitHub connecté, via le service d'exploration.
// À lancer avec : npx tsx scripts/test-github-explorer.ts
//
// Utilise le premier projet en base ayant une installation GitHub connectée
// (voir backend/src/services/github-repo-explorer.service.ts).

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getRepoTree, getFileContent } from "../src/services/github-repo-explorer.service";

async function main() {
  const project = await prisma.project.findFirst({
    where: { githubInstallationId: { not: null }, githubRepo: { not: null }, githubBranch: { not: null } },
  });

  if (!project || !project.githubInstallationId || !project.githubRepo || !project.githubBranch) {
    console.error("Aucun projet avec une installation GitHub connectée trouvé en base.");
    process.exit(1);
  }

  const [owner, repo] = project.githubRepo.split("/");
  console.log(`Projet : ${project.name} — repo ${project.githubRepo} (branche ${project.githubBranch})\n`);

  console.log("Récupération de l'arborescence...");
  const tree = await getRepoTree(project.githubInstallationId, {
    owner,
    repo,
    ref: project.githubBranch,
  });

  const files = tree.filter((entry) => entry.type === "blob");
  console.log(`${tree.length} entrée(s) au total, dont ${files.length} fichier(s).`);
  console.log("Premiers fichiers :");
  for (const file of files.slice(0, 10)) {
    console.log(`  - ${file.path}`);
  }

  const target = files.find((f) => f.path.endsWith("package.json")) ?? files[0];
  if (!target) {
    console.log("\nAucun fichier à lire pour tester getFileContent.");
    return;
  }

  console.log(`\nLecture du fichier : ${target.path}`);
  const result = await getFileContent(project.githubInstallationId, {
    owner,
    repo,
    path: target.path,
    ref: project.githubBranch,
  });

  if (!result.ok) {
    console.error(`Échec de lecture (${result.reason}) pour ${result.path}`);
    process.exit(1);
  }

  console.log(`Contenu récupéré (${result.content.length} caractères). Aperçu :\n`);
  console.log(result.content.slice(0, 300));
  console.log("\nTest réussi.");
}

main()
  .catch((err) => {
    console.error("Erreur inattendue :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
