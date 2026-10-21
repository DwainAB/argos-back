import pino from "pino";

// Logger structuré unique de l'application — jamais de console.log/console.error direct
// ailleurs dans le code. En développement, sortie colorée et lisible (pino-pretty) ; en
// production, JSON brut sur une seule ligne par entrée, exploitable par les outils
// d'agrégation de logs de l'hébergeur (Railway notamment).
const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
});
