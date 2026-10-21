import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "../test/prisma-mock";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../services/providers/github/github-app.service", () => ({
  buildGithubInstallUrl: vi.fn().mockReturnValue("https://github.com/apps/argos/installations/new?state=xyz"),
  listAppInstallations: vi.fn(),
  listInstallationRepos: vi.fn(),
  listRepoBranches: vi.fn(),
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
  ACTIVITY_ACTIONS: { GITHUB_REPO_CONNECTED: "GITHUB_REPO_CONNECTED" },
}));

import { githubIntegrationRouter, githubPublicRouter } from "./github-integration.route";
import { assertCanManageProject } from "../services/organization/organization.service";
import { listAppInstallations, listInstallationRepos, listRepoBranches } from "../services/providers/github/github-app.service";

beforeEach(() => {
  resetPrismaMock();
  vi.mocked(assertCanManageProject).mockReset();
  vi.mocked(listAppInstallations).mockReset();
  vi.mocked(listInstallationRepos).mockReset();
  vi.mocked(listRepoBranches).mockReset();
});

describe("GET /api/integrations/github/start", () => {
  const handler = getRouteHandler(githubPublicRouter, "get", "/api/integrations/github/start");

  it("pose un cookie d'état et redirige vers l'url d'installation GitHub", () => {
    const res = makeRes();

    handler({ query: { projectId: "proj-1" }, cookies: {} } as never, res);

    expect(res.cookie).toHaveBeenCalledWith("github_install_state", expect.any(String), expect.any(Object));
    expect(res.redirect).toHaveBeenCalledWith("https://github.com/apps/argos/installations/new?state=xyz");
  });
});

describe("GET /api/integrations/github/callback", () => {
  const handler = getRouteHandler(githubPublicRouter, "get", "/api/integrations/github/callback");

  it("renvoie une page d'erreur si setup_action n'est ni install ni update", () => {
    const res = makeRes();

    handler({ query: { setup_action: "autre" }, cookies: {} } as never, res);

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("installation_failed"));
  });

  it("renvoie une page d'erreur si le nonce ne correspond pas au cookie", () => {
    const res = makeRes();

    handler(
      { query: { setup_action: "install", installation_id: "123", state: "nonce-a.proj-1" }, cookies: { github_install_state: "nonce-b" } } as never,
      res,
    );

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("invalid_state"));
  });

  it("renvoie la page de succès avec l'installationId et le projectId", () => {
    const res = makeRes();

    handler(
      { query: { setup_action: "install", installation_id: "123", state: "nonce-a.proj-1" }, cookies: { github_install_state: "nonce-a" } } as never,
      res,
    );

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('"installationId":"123"'));
  });
});

describe("GET /api/integrations/github/installations", () => {
  const handler = getRouteHandler(githubIntegrationRouter, "get", "/api/integrations/github/installations");

  it("renvoie les installations disponibles", async () => {
    vi.mocked(listAppInstallations).mockResolvedValue([{ id: 1 }] as never);
    const res = makeRes();

    await handler({} as never, res);

    expect(res.json).toHaveBeenCalledWith({ installations: [{ id: 1 }] });
  });

  it("renvoie 502 en cas d'erreur de l'API GitHub", async () => {
    vi.mocked(listAppInstallations).mockRejectedValue(new Error("boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();

    await handler({} as never, res);

    expect(res.status).toHaveBeenCalledWith(502);
    consoleError.mockRestore();
  });
});

describe("GET /api/integrations/github/repos", () => {
  const handler = getRouteHandler(githubIntegrationRouter, "get", "/api/integrations/github/repos");

  it("renvoie 400 si installationId est manquant", async () => {
    const res = makeRes();

    await handler({ query: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie les dépôts de l'installation", async () => {
    vi.mocked(listInstallationRepos).mockResolvedValue([{ fullName: "owner/repo" }] as never);
    const res = makeRes();

    await handler({ query: { installationId: "123" } } as never, res);

    expect(res.json).toHaveBeenCalledWith({ repos: [{ fullName: "owner/repo" }] });
  });
});

describe("GET /api/integrations/github/branches", () => {
  const handler = getRouteHandler(githubIntegrationRouter, "get", "/api/integrations/github/branches");

  it("renvoie 400 si un paramètre requis est manquant", async () => {
    const res = makeRes();

    await handler({ query: { installationId: "123" } } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie les branches du dépôt", async () => {
    vi.mocked(listRepoBranches).mockResolvedValue(["main", "dev"] as never);
    const res = makeRes();

    await handler({ query: { installationId: "123", owner: "owner", repo: "repo" } } as never, res);

    expect(res.json).toHaveBeenCalledWith({ branches: ["main", "dev"] });
  });
});

describe("POST /api/projects/:projectId/github", () => {
  const handler = getRouteHandler(githubIntegrationRouter, "post", "/api/projects/:projectId/github");

  it("renvoie 400 si des champs requis sont manquants", async () => {
    const res = makeRes();

    await handler({ params: { projectId: "proj-1" }, body: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renvoie 404 si le projet n'est pas accessible", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const res = makeRes();

    await handler(
      { params: { projectId: "proj-1" }, body: { installationId: 1, repoFullName: "owner/repo", branch: "main" }, userId: "user-1" } as never,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("associe le dépôt GitHub au projet", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" } as never);
    vi.mocked(assertCanManageProject).mockResolvedValue(undefined as never);
    prismaMock.project.update.mockResolvedValue({ id: "proj-1", githubRepo: "owner/repo" } as never);
    const res = makeRes();

    await handler(
      { params: { projectId: "proj-1" }, body: { installationId: 1, repoFullName: "owner/repo", branch: "main" }, userId: "user-1" } as never,
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ project: expect.objectContaining({ githubRepo: "owner/repo" }) });
  });
});
