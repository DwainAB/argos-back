import { Router } from "express";
import { prisma } from "../lib/prisma";
import { listAppInstallations } from "../services/providers/github/github-app.service";
import { projectAccessFilter } from "../services/organization/project-access.service";
import { assertCanManageProject, OrganizationError } from "../services/organization/organization.service";
import { logActivity, ACTIVITY_ACTIONS } from "../services/activity/activity-log.service";

export const githubConnectionsRouter = Router();

// Liste les installations GitHub réellement utilisées par les projets accessibles à
// l'utilisateur (pas toutes les installations de la GitHub App, tous comptes Argos AI
// confondus — voir JOURNAL.md, dette technique connue de listAppInstallations()), avec le
// détail des projets concernés pour chacune.
githubConnectionsRouter.get("/api/github-connections", async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { ...(await projectAccessFilter(req.userId as string)), githubInstallationId: { not: null } },
      select: { id: true, name: true, githubInstallationId: true, githubRepo: true },
    });

    if (projects.length === 0) {
      return res.json({ connections: [] });
    }

    const installations = await listAppInstallations();
    const installationById = new Map(installations.map((i) => [i.id, i]));

    const byInstallation = new Map<number, { id: string; name: string; githubRepo: string | null }[]>();
    for (const project of projects) {
      const installationId = project.githubInstallationId as number;
      const list = byInstallation.get(installationId) ?? [];
      list.push({ id: project.id, name: project.name, githubRepo: project.githubRepo });
      byInstallation.set(installationId, list);
    }

    const connections = Array.from(byInstallation.entries()).map(([installationId, linkedProjects]) => ({
      installationId,
      accountLogin: installationById.get(installationId)?.accountLogin ?? "Compte inconnu",
      accountAvatarUrl: installationById.get(installationId)?.accountAvatarUrl ?? "",
      projects: linkedProjects,
    }));

    res.json({ connections });
  } catch (err) {
    console.error("Erreur lors de la récupération des connexions GitHub :", err);
    res.status(502).json({ error: "Impossible de récupérer les connexions GitHub." });
  }
});

// Déconnecte une installation GitHub de tous les projets Argos AI de l'utilisateur/organisation
// qui l'utilisaient — ne désinstalle jamais la GitHub App côté GitHub elle-même (pour ne pas
// couper l'accès d'un autre compte Argos AI qui partagerait la même installation). L'utilisateur
// reste libre de désinstaller l'app pour de vrai depuis github.com/settings/installations.
githubConnectionsRouter.delete("/api/github-connections/:installationId", async (req, res) => {
  const installationId = Number(req.params.installationId);

  if (!installationId) {
    return res.status(400).json({ error: "installationId invalide." });
  }

  try {
    const projects = await prisma.project.findMany({
      where: { ...(await projectAccessFilter(req.userId as string)), githubInstallationId: installationId },
    });

    for (const project of projects) {
      await assertCanManageProject(req.userId as string, project);
    }

    await prisma.project.updateMany({
      where: { id: { in: projects.map((p) => p.id) } },
      data: { githubInstallationId: null, githubRepo: null, githubBranch: null },
    });

    for (const project of projects) {
      await logActivity({
        userId: req.userId as string,
        action: ACTIVITY_ACTIONS.GITHUB_INSTALLATION_DISCONNECTED,
        entityType: "Project",
        entityId: project.id,
        projectId: project.id,
        metadata: { previousRepo: project.githubRepo },
      });
    }

    res.status(204).end();
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de la déconnexion GitHub de l'installation ${installationId} :`, err);
    res.status(500).json({ error: "Impossible de déconnecter cette installation GitHub." });
  }
});
