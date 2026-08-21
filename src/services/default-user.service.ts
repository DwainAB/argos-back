import { prisma } from "../lib/prisma";

// Utilisateur de test unique, utilisé le temps que la vraie authentification Argos AI
// soit en place. Tous les projets connectés sont rattachés à cet utilisateur pour l'instant.
// TODO : retirer une fois l'authentification réelle construite.
const DEFAULT_USER_EMAIL = "marinesola348@gmail.com";

export async function getOrCreateDefaultUser() {
  return prisma.user.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: { email: DEFAULT_USER_EMAIL },
  });
}
