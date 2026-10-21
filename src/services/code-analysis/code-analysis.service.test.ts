import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/github/github-repo-explorer.service", () => ({
  getRepoTree: vi.fn(),
  getFileContent: vi.fn(),
  getFileContentRange: vi.fn(),
}));
vi.mock("../providers/gitlab/gitlab-repo-explorer.service", () => ({
  getRepoTree: vi.fn(),
  getFileContent: vi.fn(),
  getFileContentRange: vi.fn(),
}));

import { buildCodeSource, estimateCodeAnalysis, type RepoTreeEntry } from "./code-analysis.service";
import * as githubExplorer from "../providers/github/github-repo-explorer.service";

beforeEach(() => {
  vi.mocked(githubExplorer.getRepoTree).mockReset();
});

describe("buildCodeSource", () => {
  it("renvoie null si le projet n'a ni dépôt GitHub ni GitLab connecté", () => {
    const source = buildCodeSource({ githubInstallationId: null, githubRepo: null, githubBranch: null, gitlabConnectionId: null, gitlabProjectId: null, gitlabBranch: null } as never);
    expect(source).toBeNull();
  });

  it("préfère GitHub si les deux fournisseurs sont renseignés", () => {
    const source = buildCodeSource({
      githubInstallationId: 1,
      githubRepo: "owner/repo",
      githubBranch: "main",
      gitlabConnectionId: "conn-1",
      gitlabProjectId: 42,
      gitlabBranch: "main",
    } as never);

    expect(source).not.toBeNull();
  });

  it("construit une source GitLab si seul GitLab est connecté", () => {
    const source = buildCodeSource({
      githubInstallationId: null,
      githubRepo: null,
      githubBranch: null,
      gitlabConnectionId: "conn-1",
      gitlabProjectId: 42,
      gitlabBranch: "main",
    } as never);

    expect(source).not.toBeNull();
  });
});

describe("estimateCodeAnalysis", () => {
  function makeSource(entries: RepoTreeEntry[]) {
    return {
      listTree: vi.fn().mockResolvedValue(entries),
      getFile: vi.fn(),
      getFileRange: vi.fn(),
    };
  }

  it("ignore les fichiers non analysables (extensions hors liste, dossiers ignorés)", async () => {
    const source = makeSource([
      { path: "src/index.ts", type: "blob" },
      { path: "image.png", type: "blob" },
      { path: "node_modules/pkg/index.js", type: "blob" },
      { path: "src", type: "tree" },
    ]);

    const estimate = await estimateCodeAnalysis(source);

    expect(estimate.filesToAnalyze).toBe(1);
  });

  it("renvoie un minimum de 5 secondes même sans fichier à analyser", async () => {
    const source = makeSource([]);

    const estimate = await estimateCodeAnalysis(source);

    expect(estimate.filesToAnalyze).toBe(0);
    expect(estimate.estimatedSeconds).toBeGreaterThanOrEqual(5);
  });

  it("augmente le temps estimé avec le nombre de fichiers", async () => {
    const manyFiles: RepoTreeEntry[] = Array.from({ length: 50 }, (_, i) => ({ path: `src/file${i}.ts`, type: "blob" as const }));
    const source = makeSource(manyFiles);

    const estimate = await estimateCodeAnalysis(source);

    expect(estimate.filesToAnalyze).toBe(50);
    expect(estimate.estimatedSeconds).toBeGreaterThan(10);
  });
});
