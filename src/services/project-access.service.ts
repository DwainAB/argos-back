// Clause Prisma "where" pour un Project accessible à un utilisateur donné : soit il en
// est le propriétaire, soit il en a reçu l'accès via un partage (voir ProjectShare et
// project-share.service.ts). Centralisée ici pour être réutilisée telle quelle par
// toutes les routes qui filtrent des projets (et, en remontant la relation, des logs et
// alertes) par utilisateur.
export function projectAccessFilter(userId: string) {
  return {
    OR: [{ userId }, { shares: { some: { sharedWithUserId: userId } } }],
  };
}
