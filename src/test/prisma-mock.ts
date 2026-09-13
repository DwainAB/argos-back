import { PrismaClient } from "@prisma/client";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";

// Mock profond de PrismaClient réutilisable par les tests de services : évite toute vraie
// connexion base de données, chaque test contrôle directement ce que chaque appel Prisma
// renvoie (ex. prismaMock.user.findUnique.mockResolvedValue(...)).
//
// vi.mock() est hoisté et résout son chemin relativement au fichier qui l'appelle : chaque
// fichier de test doit donc écrire lui-même `vi.mock("../../lib/prisma", () => ({ prisma:
// prismaMock }))` avec le bon chemin relatif, ce module ne peut pas le faire à sa place.
export const prismaMock = mockDeep<PrismaClient>() as DeepMockProxy<PrismaClient>;

export function resetPrismaMock() {
  mockReset(prismaMock);
}
