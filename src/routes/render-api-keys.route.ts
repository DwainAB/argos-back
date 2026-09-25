import { Router } from "express";
import {
  createRenderApiKey,
  deleteRenderApiKey,
  listRenderApiKeys,
  RenderApiKeyError,
} from "../services/providers/render/render-api-key.service";

export const renderApiKeysRouter = Router();

renderApiKeysRouter.get("/api/render-api-keys", async (req, res) => {
  try {
    const keys = await listRenderApiKeys(req.userId as string);
    res.json({ keys });
  } catch (err) {
    console.error("Erreur lors de la récupération des clés API Render :", err);
    res.status(500).json({ error: "Impossible de récupérer les clés API Render." });
  }
});

renderApiKeysRouter.post("/api/render-api-keys", async (req, res) => {
  const { apiKey, label } = req.body ?? {};

  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: "apiKey est requis." });
  }

  try {
    const key = await createRenderApiKey(req.userId as string, { apiKey, label });
    res.status(201).json({ key });
  } catch (err) {
    if (err instanceof RenderApiKeyError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de l'enregistrement de la clé API Render :", err);
    res.status(500).json({ error: "Impossible d'enregistrer cette clé API." });
  }
});

renderApiKeysRouter.delete("/api/render-api-keys/:keyId", async (req, res) => {
  const { keyId } = req.params;

  try {
    await deleteRenderApiKey(req.userId as string, keyId);
    res.status(204).end();
  } catch (err) {
    if (err instanceof RenderApiKeyError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de la suppression de la clé API Render ${keyId} :`, err);
    res.status(500).json({ error: "Impossible de supprimer cette clé API." });
  }
});
