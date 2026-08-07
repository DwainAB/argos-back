import { PrismaClient } from "@prisma/client";

// Instance unique du client Prisma, partagée dans toute l'application.
export const prisma = new PrismaClient();
