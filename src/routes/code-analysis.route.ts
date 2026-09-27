import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  estimateCodeAnalysis,
  runCodeAnalysis,
  buildCodeSource,
  type CodeFinding,
  type FindingStatus,
} from "../services/code-analysis/code-analysis.service";
import { projectAccessFilter } from "../services/organization/project-access.service";
import { getSubscriptionForRequestingUser, tryConsumeCodeAnalysisQuota } from "../services/billing/subscription.service";

const VALID_STATUSES: FindingStatus[] = ["open", "resolved", "ignored"];

export const codeAnalysisRouter = Router();

async function findAccessibleProject(userId: string, projectId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ...(await projectAccessFilter(userId)) } });
}

codeAnalysisRouter.get("/api/projects/:projectId/code-analysis/estimate", async (req, res) => {
  const { projectId } = req.params;

  try {
    const project = await findAccessibleProject(req.userId as string, projectId);
    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const source = buildCodeSource(project);
    if (!source) {
      return res.status(422).json({ error: "Ce projet n'a pas de dépôt GitHub ou GitLab connecté." });
    }

    const estimate = await estimateCodeAnalysis(source);

    res.json(estimate);
  } catch (err) {
    console.error(`Erreur lors de l'estimation d'analyse de code du projet ${projectId} :`, err);
    res.status(502).json({ error: "Impossible d'estimer l'analyse de ce dépôt." });
  }
});

codeAnalysisRouter.post("/api/projects/:projectId/code-analysis", async (req, res) => {
  const { projectId } = req.params;

  try {
    const project = await findAccessibleProject(req.userId as string, projectId);
    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const source = buildCodeSource(project);
    if (!source) {
      return res.status(422).json({ error: "Ce projet n'a pas de dépôt GitHub ou GitLab connecté." });
    }

    const subscription = await getSubscriptionForRequestingUser(req.userId as string);
    if (subscription) {
      const requestingUser = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
      const allowed = await tryConsumeCodeAnalysisQuota(subscription, requestingUser?.email ?? "");
      if (!allowed) {
        return res.status(429).json({ error: "Quota mensuel d'analyses de code atteint pour votre abonnement." });
      }
    }

    const analysis = await prisma.codeAnalysis.create({ data: { projectId, status: "running" } });

    // Répond immédiatement : l'analyse peut prendre de quelques secondes à quelques minutes
    // selon la taille du dépôt, le frontend récupère le résultat en repassant par l'historique.
    res.status(202).json({ analysis });

    // La dernière analyse déjà terminée sert de référence : ses findings encore "open" sont
    // revérifiés par l'IA (toujours présents ou corrigés) plutôt que redétectés à l'aveugle.
    const previousAnalysis = await prisma.codeAnalysis.findFirst({
      where: { projectId, status: "done", id: { not: analysis.id } },
      orderBy: { createdAt: "desc" },
    });
    const previousOpenFindings = (
      Array.isArray(previousAnalysis?.findings) ? (previousAnalysis.findings as unknown as CodeFinding[]) : []
    ).filter((f) => f.status === "open");

    runCodeAnalysis(source, previousOpenFindings)
      .then((result) =>
        prisma.codeAnalysis.update({
          where: { id: analysis.id },
          data: {
            status: "done",
            filesScanned: result.filesScanned,
            scores: result.scores,
            findings: result.findings,
            completedAt: new Date(),
          },
        })
      )
      .catch(async (err) => {
        console.error(`Erreur lors de l'analyse de code ${analysis.id} (projet ${projectId}) :`, err);
        await prisma.codeAnalysis.update({
          where: { id: analysis.id },
          data: { status: "failed", errorMessage: err instanceof Error ? err.message : String(err), completedAt: new Date() },
        }).catch(() => {});
      });
  } catch (err) {
    console.error(`Erreur lors du lancement de l'analyse de code du projet ${projectId} :`, err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Impossible de lancer l'analyse de ce dépôt." });
    }
  }
});

codeAnalysisRouter.get("/api/projects/:projectId/code-analysis", async (req, res) => {
  const { projectId } = req.params;

  try {
    const project = await findAccessibleProject(req.userId as string, projectId);
    if (!project) {
      return res.status(404).json({ error: "Projet introuvable." });
    }

    const analyses = await prisma.codeAnalysis.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ analyses });
  } catch (err) {
    console.error(`Erreur lors de la récupération des analyses de code du projet ${projectId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer les analyses de code." });
  }
});

codeAnalysisRouter.get("/api/code-analysis/:analysisId", async (req, res) => {
  const { analysisId } = req.params;

  try {
    const analysis = await prisma.codeAnalysis.findFirst({
      where: { id: analysisId, project: await projectAccessFilter(req.userId as string) },
    });

    if (!analysis) {
      return res.status(404).json({ error: "Analyse introuvable." });
    }

    res.json({ analysis });
  } catch (err) {
    console.error(`Erreur lors de la récupération de l'analyse de code ${analysisId} :`, err);
    res.status(500).json({ error: "Impossible de récupérer cette analyse." });
  }
});

// Change le statut d'un finding précis (open/resolved/ignored). Accessible à tout membre
// ayant accès au projet, comme pour la résolution des alertes — pas restreint aux admins.
codeAnalysisRouter.patch("/api/code-analysis/:analysisId/findings/:findingId", async (req, res) => {
  const { analysisId, findingId } = req.params;
  const { status } = req.body ?? {};

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Statut invalide." });
  }

  try {
    const analysis = await prisma.codeAnalysis.findFirst({
      where: { id: analysisId, project: await projectAccessFilter(req.userId as string) },
    });

    if (!analysis) {
      return res.status(404).json({ error: "Analyse introuvable." });
    }

    const findings = Array.isArray(analysis.findings) ? (analysis.findings as unknown as CodeFinding[]) : [];
    const findingIndex = findings.findIndex((f) => f.id === findingId);

    if (findingIndex === -1) {
      return res.status(404).json({ error: "Problème introuvable dans cette analyse." });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { firstName: true, lastName: true } });

    const updatedFinding: CodeFinding = {
      ...findings[findingIndex],
      status,
      resolvedBy: status === "resolved" && user ? { userId: req.userId as string, firstName: user.firstName, lastName: user.lastName } : null,
      resolvedAt: status === "resolved" ? new Date().toISOString() : null,
    };

    const updatedFindings = [...findings];
    updatedFindings[findingIndex] = updatedFinding;

    await prisma.codeAnalysis.update({ where: { id: analysisId }, data: { findings: updatedFindings } });

    res.json({ finding: updatedFinding });
  } catch (err) {
    console.error(`Erreur lors de la mise à jour du problème ${findingId} (analyse ${analysisId}) :`, err);
    res.status(500).json({ error: "Impossible de mettre à jour ce problème." });
  }
});
