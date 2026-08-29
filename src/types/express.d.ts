// Étend le type Request d'Express pour porter l'id de l'utilisateur authentifié, attaché
// par auth.middleware.ts une fois le cookie de session vérifié.
declare namespace Express {
  export interface Request {
    userId?: string;
  }
}
