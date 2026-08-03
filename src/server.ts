import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { healthRouter } from "./routes/health.route";

const app = express();

app.use(cors());
app.use(express.json());
app.use(healthRouter);

app.listen(env.port, () => {
  console.log(`Guardian AI backend listening on port ${env.port}`);
});
