import { Router } from "express";
import { fetchAccessibleServices } from "../services/providers/render/render-api.service";
import { getDecryptedRenderApiKey, RenderApiKeyError } from "../services/providers/render/render-api-key.service";

export const renderIntegrationRouter = Router();

// Accepte soit apiKey en clair (nouvelle clé, pas encore enregistrée), soit apiKeyId (clé déjà
// stockée) — dans ce second cas la clé est déchiffrée côté serveur, jamais renvoyée au client.
renderIntegrationRouter.get("/api/integrations/render/services", async (req, res) => {
  const { apiKey, apiKeyId } = req.query;

  if (!apiKey && !apiKeyId) {
    return res.status(400).json({ error: "Paramètre apiKey ou apiKeyId requis." });
  }

  try {
    const resolvedApiKey = apiKeyId
      ? await getDecryptedRenderApiKey(req.userId as string, String(apiKeyId))
      : String(apiKey);

    const services = await fetchAccessibleServices(resolvedApiKey);
    res.json({ services });
  } catch (err) {
    if (err instanceof RenderApiKeyError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Erreur lors de la récupération des services Render :", err);
    res.status(502).json({ error: "Impossible de récupérer les services Render. Vérifiez la clé API." });
  }
});
