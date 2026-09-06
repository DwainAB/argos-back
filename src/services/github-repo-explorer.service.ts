import { getInstallationOctokit } from "./github-app.service";

const MAX_FILE_SIZE_BYTES = 100 * 1024;

export type RepoTreeEntry = {
  path: string;
  type: "blob" | "tree";
};

export async function getRepoTree(
  installationId: number,
  params: { owner: string; repo: string; ref: string }
): Promise<RepoTreeEntry[]> {
  const octokit = getInstallationOctokit(installationId);

  const { data: refData } = await octokit.rest.git.getRef({
    owner: params.owner,
    repo: params.repo,
    ref: `heads/${params.ref}`,
  });

  const { data: tree } = await octokit.rest.git.getTree({
    owner: params.owner,
    repo: params.repo,
    tree_sha: refData.object.sha,
    recursive: "true",
  });

  return tree.tree
    .filter((entry): entry is typeof entry & { path: string; type: "blob" | "tree" } =>
      Boolean(entry.path) && (entry.type === "blob" || entry.type === "tree")
    )
    .map((entry) => ({ path: entry.path, type: entry.type }));
}

export type FileContentResult =
  | { ok: true; path: string; content: string }
  | { ok: false; path: string; reason: "not_found" | "too_large" | "not_a_file"; totalLines?: number };

async function fetchRawFile(
  installationId: number,
  params: { owner: string; repo: string; path: string; ref: string }
): Promise<{ ok: true; content: string; sizeBytes: number } | { ok: false; reason: "not_found" | "not_a_file" }> {
  const octokit = getInstallationOctokit(installationId);

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.ref,
    });

    if (Array.isArray(data) || data.type !== "file") {
      return { ok: false, reason: "not_a_file" };
    }

    const content = Buffer.from(data.content, data.encoding as BufferEncoding).toString("utf-8");
    return { ok: true, content, sizeBytes: data.size };
  } catch (err: any) {
    if (err?.status === 404) {
      return { ok: false, reason: "not_found" };
    }
    throw err;
  }
}

export async function getFileContent(
  installationId: number,
  params: { owner: string; repo: string; path: string; ref: string }
): Promise<FileContentResult> {
  const raw = await fetchRawFile(installationId, params);

  if (!raw.ok) {
    return { ok: false, path: params.path, reason: raw.reason };
  }

  if (raw.sizeBytes > MAX_FILE_SIZE_BYTES) {
    const totalLines = raw.content.split("\n").length;
    return { ok: false, path: params.path, reason: "too_large", totalLines };
  }

  return { ok: true, path: params.path, content: raw.content };
}

export type FileContentRangeResult =
  | { ok: true; path: string; content: string; startLine: number; endLine: number; totalLines: number }
  | { ok: false; path: string; reason: "not_found" | "not_a_file" };

export async function getFileContentRange(
  installationId: number,
  params: { owner: string; repo: string; path: string; ref: string; startLine: number; endLine: number }
): Promise<FileContentRangeResult> {
  const raw = await fetchRawFile(installationId, params);

  if (!raw.ok) {
    return { ok: false, path: params.path, reason: raw.reason };
  }

  const lines = raw.content.split("\n");
  const totalLines = lines.length;
  const start = Math.max(1, params.startLine);
  const end = Math.min(totalLines, params.endLine);

  const content = lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}: ${line}`)
    .join("\n");

  return { ok: true, path: params.path, content, startLine: start, endLine: end, totalLines };
}
