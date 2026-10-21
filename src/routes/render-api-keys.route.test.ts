import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../services/providers/render/render-api-key.service", () => ({
  createRenderApiKey: vi.fn(),
  deleteRenderApiKey: vi.fn(),
  listRenderApiKeys: vi.fn(),
  RenderApiKeyError: class RenderApiKeyError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
}));

import { renderApiKeysRouter } from "./render-api-keys.route";
import {
  createRenderApiKey,
  deleteRenderApiKey,
  listRenderApiKeys,
  RenderApiKeyError,
} from "../services/providers/render/render-api-key.service";

beforeEach(() => {
  vi.mocked(createRenderApiKey).mockReset();
  vi.mocked(deleteRenderApiKey).mockReset();
  vi.mocked(listRenderApiKeys).mockReset();
});

describe("GET /api/render-api-keys", () => {
  const handler = getRouteHandler(renderApiKeysRouter, "get", "/api/render-api-keys");

  it("renvoie les clés de l'utilisateur", async () => {
    vi.mocked(listRenderApiKeys).mockResolvedValue([{ id: "key-1" }] as never);
    const res = makeRes();

    await handler({ userId: "user-1" } as never, res);

    expect(res.json).toHaveBeenCalledWith({ keys: [{ id: "key-1" }] });
  });
});

describe("POST /api/render-api-keys", () => {
  const handler = getRouteHandler(renderApiKeysRouter, "post", "/api/render-api-keys");

  it("renvoie 400 si apiKey est manquant", async () => {
    const res = makeRes();

    await handler({ body: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("crée la clé et répond 201", async () => {
    vi.mocked(createRenderApiKey).mockResolvedValue({ id: "key-1" } as never);
    const res = makeRes();

    await handler({ body: { apiKey: "rnd_123" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("propage le code d'erreur d'une RenderApiKeyError", async () => {
    vi.mocked(createRenderApiKey).mockRejectedValue(new RenderApiKeyError("Clé invalide.", 422));
    const res = makeRes();

    await handler({ body: { apiKey: "mauvaise-cle" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe("DELETE /api/render-api-keys/:keyId", () => {
  const handler = getRouteHandler(renderApiKeysRouter, "delete", "/api/render-api-keys/:keyId");

  it("supprime la clé et répond 204", async () => {
    vi.mocked(deleteRenderApiKey).mockResolvedValue(undefined as never);
    const res = makeRes();

    await handler({ params: { keyId: "key-1" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("renvoie 404 si la clé n'existe pas", async () => {
    vi.mocked(deleteRenderApiKey).mockRejectedValue(new RenderApiKeyError("Clé introuvable.", 404));
    const res = makeRes();

    await handler({ params: { keyId: "key-inconnue" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
