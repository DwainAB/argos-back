import { Router } from "express";
import { prisma } from "../lib/prisma";
import { projectAccessFilter } from "../services/organization/project-access.service";
import { assertCanManageProject, OrganizationError } from "../services/organization/organization.service";

export const gitlabConnectionsRouter = Router();

// Liste les connexions GitLab de l'utilisateur/organisation courant, avec le détail des
// projets Argos AI qui les utilisent — équivalent de /api/github-connections, mais ici la
// connexion appartient directement au compte (pas de concept d'installation partagée entre
// plusieurs comptes Argos AI comme pour la GitHub App).
gitlabConnectionsRouter.get("/api/gitlab-connections", async (req, res) => {
  try {
    const membership = await prisma.organizationMembership.findUnique({ where: { userId: req.userId as string } });

    const connections = await prisma.gitlabConnection.findMany({
      where: membership ? { organizationId: membership.organizationId } : { userId: req.userId as string },
      orderBy: { createdAt: "desc" },
    });

    if (connections.length === 0) {
      return res.json({ connections: [] });
    }

    const projects = await prisma.project.findMany({
      where: { ...(await projectAccessFilter(req.userId as string)), gitlabConnectionId: { in: connections.map((c) => c.id) } },
      select: { id: true, name: true, gitlabConnectionId: true, gitlabRepo: true },
    });

    const projectsByConnection = new Map<string, { id: string; name: string; gitlabRepo: string | null }[]>();
    for (const project of projects) {
      const connectionId = project.gitlabConnectionId as string;
      const list = projectsByConnection.get(connectionId) ?? [];
      list.push({ id: project.id, name: project.name, gitlabRepo: project.gitlabRepo });
      projectsByConnection.set(connectionId, list);
    }

    res.json({
      connections: connections.map((c) => ({
        id: c.id,
        gitlabUserLogin: c.gitlabUserLogin,
        projects: projectsByConnection.get(c.id) ?? [],
      })),
    });
  } catch (err) {
    console.error("Erreur lors de la récupération des connexions GitLab :", err);
    res.status(502).json({ error: "Impossible de récupérer les connexions GitLab." });
  }
});

// Supprime la connexion GitLab et détache tous les projets Argos AI qui l'utilisaient — ne
// révoque pas le token côté GitLab lui-même, l'utilisateur reste libre de révoquer l'accès
// depuis gitlab.com/-/profile/applications.
gitlabConnectionsRouter.delete("/api/gitlab-connections/:connectionId", async (req, res) => {
  const { connectionId } = req.params;

  try {
    const projects = await prisma.project.findMany({
      where: { ...(await projectAccessFilter(req.userId as string)), gitlabConnectionId: connectionId },
    });

    for (const project of projects) {
      await assertCanManageProject(req.userId as string, project);
    }

    await prisma.project.updateMany({
      where: { id: { in: projects.map((p) => p.id) } },
      data: { gitlabConnectionId: null, gitlabRepo: null, gitlabBranch: null, gitlabProjectId: null },
    });

    await prisma.gitlabConnection.delete({ where: { id: connectionId } });

    res.status(204).end();
  } catch (err) {
    if (err instanceof OrganizationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`Erreur lors de la déconnexion GitLab ${connectionId} :`, err);
    res.status(500).json({ error: "Impossible de déconnecter GitLab." });
  }
});
