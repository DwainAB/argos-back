import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./github-app.service", () => ({ getInstallationOctokit: vi.fn() }));

import { getInstallationOctokit } from "./github-app.service";
import { createFixPullRequest } from "./github-pr.service";

function makeOctokit() {
  return {
    rest: {
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "base-sha" } } }),
        createRef: vi.fn().mockResolvedValue({}),
      },
      repos: {
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: "file",
            content: Buffer.from("const x = 1;\nconst oldCode = 2;\n").toString("base64"),
            encoding: "base64",
            sha: "file-sha",
          },
        }),
        createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({ data: { html_url: "https://github.com/owner/repo/pull/1" } }),
      },
    },
  };
}

const baseParams = {
  installationId: 1,
  owner: "owner",
  repo: "repo",
  baseBranch: "main",
  filePath: "src/index.ts",
  oldCode: "const oldCode = 2;",
  newCode: "const newCode = 3;",
  explanation: "Correction du bug X",
  commitMessage: "fix: correction du bug X",
};

beforeEach(() => {
  vi.mocked(getInstallationOctokit).mockReset();
});

describe("createFixPullRequest", () => {
  it("crée une branche, remplace le code, pousse le commit et ouvre une PR", async () => {
    const octokit = makeOctokit();
    vi.mocked(getInstallationOctokit).mockReturnValue(octokit as never);

    const url = await createFixPullRequest(baseParams);

    expect(url).toBe("https://github.com/owner/repo/pull/1");
    expect(octokit.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "base-sha", ref: expect.stringContaining("refs/heads/guardian-ai/fix-") }),
    );
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "file-sha", message: "fix: correction du bug X" }),
    );
    expect(octokit.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ base: "main", body: "Correction du bug X" }),
    );
  });

  it("lève une erreur si le chemin cible n'est pas un fichier", async () => {
    const octokit = makeOctokit();
    octokit.rest.repos.getContent.mockResolvedValue({ data: [] });
    vi.mocked(getInstallationOctokit).mockReturnValue(octokit as never);

    await expect(createFixPullRequest(baseParams)).rejects.toThrow("ne correspond pas à un fichier");
  });

  it("lève une erreur si le code attendu n'est plus présent dans le fichier", async () => {
    const octokit = makeOctokit();
    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        type: "file",
        content: Buffer.from("plus aucun rapport avec le code attendu").toString("base64"),
        encoding: "base64",
        sha: "file-sha",
      },
    });
    vi.mocked(getInstallationOctokit).mockReturnValue(octokit as never);

    await expect(createFixPullRequest(baseParams)).rejects.toThrow("n'a pas été retrouvé tel quel");
  });
});
