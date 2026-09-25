import { Router } from "express";
import { fetchAccessibleServices } from "../services/providers/render/render-api.service";

export const renderIntegrationRouter = Router();

renderIntegrationRouter.get("/api/integrations/render/services", async (req, res) => {
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "Paramètre apiKey requis." });
  }

  try {
    const services = await fetchAccessibleServices(String(apiKey));
    res.json({ services });
  } catch (err) {
    console.error("Erreur lors de la récupération des services Render :", err);
    res.status(502).json({ error: "Impossible de récupérer les services Render. Vérifiez la clé API." });
  }
});
