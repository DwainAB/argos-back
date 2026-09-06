import { Router } from "express";
import { ProjectShareError, listShares, shareProject, unshareProject } from "../services/project-share.service";

export const projectSharesRouter = Router();

projectSharesRouter.post("/api/projects/:projectId/shares", async (req, res) => {
  const { projectId } = req.params;

  try {
    const share = await shareProject({ projectId, ownerUserId: req.userId as string, email: req.body?.email });
    res.status(201).json({ share });
  } catch (err) {
    if (err instanceof ProjectShareError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors du partage du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de partager ce projet." });
  }
});

projectSharesRouter.get("/api/projects/:projectId/shares", async (req, res) => {
  const { projectId } = req.params;

  try {
    const shares = await listShares(projectId, req.userId as string);
    res.json({ shares });
  } catch (err) {
    if (err instanceof ProjectShareError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de la récupération des partages du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer les partages." });
  }
});

projectSharesRouter.delete("/api/projects/:projectId/shares/:shareId", async (req, res) => {
  const { projectId, shareId } = req.params;

  try {
    await unshareProject({ projectId, ownerUserId: req.userId as string, shareId });
    res.status(204).end();
  } catch (err) {
    if (err instanceof ProjectShareError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de la suppression du partage ${shareId} :`, err);
    res.status(500).json({ error: "Impossible de retirer ce partage." });
  }
});
