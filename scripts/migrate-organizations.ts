import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const businessUsers = await prisma.user.findMany({
    where: { accountType: "organization" },
  });

  console.log(`${businessUsers.length} compte(s) business à migrer.`);

  for (const user of businessUsers) {
    const existing = await prisma.organizationMembership.findUnique({ where: { userId: user.id } });
    if (existing) {
      console.log(`- ${user.email} déjà rattaché à une organisation, ignoré.`);
      continue;
    }

    const organization = await prisma.organization.create({
      data: { name: user.organizationName ?? `${user.firstName} ${user.lastName}` },
    });

    await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id, role: "admin" },
    });

    const { count } = await prisma.project.updateMany({
      where: { userId: user.id },
      data: { organizationId: organization.id },
    });

    console.log(`- ${user.email} -> organisation "${organization.name}" (${organization.id}), admin, ${count} projet(s) rattaché(s).`);
  }

  console.log("Migration terminée.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
