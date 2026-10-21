import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/encryption", () => ({ encryptSecret: vi.fn().mockReturnValue("chiffre") }));
vi.mock("../services/providers/gitlab/gitlab-oauth.service", () => ({
  buildGitlabAuthorizeUrl: vi.fn().mockReturnValue("https://gitlab.com/oauth/authorize?state=xyz"),
  exchangeCodeForToken: vi.fn(),
  generatePkcePair: vi.fn().mockReturnValue({ codeVerifier: "verifier-123", codeChallenge: "challenge-123" }),
}));
vi.mock("../services/providers/gitlab/gitlab-api.service", () => ({
  fetchGitlabUser: vi.fn(),
  listGitlabProjects: vi.fn(),
  listGitlabBranches: vi.fn(),
}));
vi.mock("../services/organization/project-access.service", () => ({ projectAccessFilter: vi.fn().mockResolvedValue({}) }));
vi.mock("../services/organization/organization.service", () => ({
  assertCanManageProject: vi.fn(),
  OrganizationError: class OrganizationError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("../services/activity/activity-log.service", () => ({
  logActivity: vi.fn(),
  ACTIVITY_ACTIONS: { GITLAB_REPO_CONNECTED: "GITLAB_REPO_CONNECTED" },
}));

import { gitlabIntegrationRouter, gitlabPublicRouter } from "./gitlab-integration.route";
import { assertCanManageProject } from "../services/organization/organization.service";
import { exchangeCodeForToken } from "../services/providers/gitlab/gitlab-oauth.service";
import { fetchGitlabUser, listGitlabBranches, listGitlabProjects } from "../services/providers/gitlab/gitlab-api.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(assertCanManageProject).mockReset();
  vi.mocked(exchangeCodeForToken).mockReset();
  vi.mocked(fetchGitlabUser).mockReset();
  vi.mocked(listGitlabProjects).mockReset();
  vi.mocked(listGitlabBranches).mockReset();
});

describe("GET /api/integrations/gitlab/start", () => {
  const handler = getRouteHandler(gitlabPublicRouter, "get", "/api/integrations/gitlab/start");

  it("pose les cookies d'état/verifier et redirige vers GitLab", () => {
    const res = makeRes();

    handler({ query: { projectId: "proj-1" }, cookies: {} } as never, res);

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.redirect).toHaveBeenCalledWith("https://gitlab.com/oauth/authorize?state=xyz");
  });
});

describe("GET /api/integrations/gitlab/callback", () => {
  const handler = getRouteHandler(gitlabPublicRouter, "get", "/api/integrations/gitlab/callback");

  it("renvoie une page d'erreur si GitLab renvoie un paramètre error", async () => {
    const res = makeRes();

    await handler({ query: { error: "access_denied" }, cookies: {} } as never, res);

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("access_denied"));
  });

  it("renvoie une page d'erreur si l'état ne correspond pas", async () => {
    const res = makeRes();

    await handler(
      { query: { code: "abc", state: "nonce-a.proj-1" }, cookies: { gitlab_oauth_state: "nonce-b", gitlab_oauth_verifier: "v" } } as never,
      res,
    );

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("invalid_state"));
  });

  it("échange le code et renvoie les informations de connexion GitLab", async () => {
    vi.mocked(exchangeCodeForToken).mockResolvedValue({ access_token: "at", refresh_token: "rt", expires_in: 3600 } as never);
    vi.mocked(fetchGitlabUser).mockResolvedValue({ id: 42, username: "jdupont", email: "j@example.com" } as never);
    const res = makeRes();

    await handler(
      {
        query: { code: "abc", state: "nonce-a.proj-1" },
        cookies: { gitlab_oauth_state: "nonce-a", gitlab_oauth_verifier: "verifier-123" },
      } as never,
      res,
    );

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('"gitlabUserId":42'));
  });

  it("renvoie une page d'erreur si l'échange du token échoue", async () => {
    vi.mocked(exchangeCodeForToken).mockRejectedValue(new Error("boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();

    await handler(
      {
        query: { code: "abc", state: "nonce-a.proj-1" },
        cookies: { gitlab_oauth_state: "nonce-a", gitlab_oauth_verifier: "verifier-123" },
      } as never,
      res,
    );

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("token_exchange_failed"));
    consoleError.mockRestore();
  });
});

describe("POST /api/gitlab-connections", () => {
  const handler = getRouteHandler(gitlabIntegrationRouter, "post", "/api/gitlab-connections");

  it("renvoie 400 si des informations sont manquantes", async () => {
    const res = makeRes();

    await handler({ body: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("crée la connexion GitLab avec les tokens chiffrés", async () => {
    prismaMock.organizationMembership.findUnique.mockResolvedValue(null);
    prismaMock.gitlabConnection.create.mockResolvedValue({ id: "conn-1", gitlabUserLogin: "jdupont" } as never);
    const res = makeRes();

    await handler(
      {
        body: { accessToken: "at", refreshToken: "rt", expiresIn: 3600, gitlabUserId: 42, gitlabUserLogin: "jdupont" },
        userId: "user-1",
      } as never,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ connectionId: "conn-1", gitlabUserLogin: "jdupont" });
  });
});

describe("GET /api/integrations/gitlab/projects", () => {
  const handler = getRouteHandler(gitlabIntegrationRouter, "get", "/api/integrations/gitlab/projects");

  it("renvoie 400 si connectionId est manquant", async () => {
    const res = makeRes();

    await handler({ query: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie les projets GitLab de la connexion", async () => {
    vi.mocked(listGitlabProjects).mockResolvedValue([{ id: 1 }] as never);
    const res = makeRes();

    await handler({ query: { connectionId: "conn-1" } } as never, res);

    expect(res.json).toHaveBeenCalledWith({ projects: [{ id: 1 }] });
  });
});

describe("GET /api/integrations/gitlab/branches", () => {
  const handler = getRouteHandler(gitlabIntegrationRouter, "get", "/api/integrations/gitlab/branches");

  it("renvoie 400 si gitlabProjectId est manquant", async () => {
    const res = makeRes();

    await handler({ query: { connectionId: "conn-1" } } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie les branches du projet GitLab", async () => {
    vi.mocked(listGitlabBranches).mockResolvedValue(["main"] as never);
    const res = makeRes();

    await handler({ query: { connectionId: "conn-1", gitlabProjectId: "42" } } as never, res);

    expect(res.json).toHaveBeenCalledWith({ branches: ["main"] });
  });
});

describe("POST /api/projects/:projectId/gitlab", () => {
  const handler = getRouteHandler(gitlabIntegrationRouter, "post", "/api/projects/:projectId/gitlab");

  it("renvoie 400 si des champs requis sont manquants", async () => {
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, body: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 404 si le projet n'est pas accessible", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler(
      { params: { projectId: "proj-1" }, body: { connectionId: "c-1", gitlabProjectId: 42, repoFullPath: "group/repo", branch: "main" }, userId: "user-1" } as never,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("associe le dépôt GitLab au projet", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    vi.mocked(assertCanManageProject).mockResolvedValue(undefined as never);
    prismaMock.project.update.mockResolvedValue({ id: "proj-1", gitlabRepo: "group/repo" } as never);
    const res = makeRes();

    await handler(
      { params: { projectId: "proj-1" }, body: { connectionId: "c-1", gitlabProjectId: 42, repoFullPath: "group/repo", branch: "main" }, userId: "user-1" } as never,
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ project: expect.objectContaining({ gitlabRepo: "group/repo" }) });
  });
});
