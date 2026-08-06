import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  railway: {
    projectToken: process.env.RAILWAY_PROJECT_TOKEN ?? "",
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? "",
    serviceId: process.env.RAILWAY_SERVICE_ID ?? "",
  },
};
