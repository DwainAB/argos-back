import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRouteHandler, makeRes } from "../test/route-helpers";

vi.mock("../services/providers/render/render-api.service", () => ({ fetchAccessibleServices: vi.fn() }));
vi.mock("../services/providers/render/render-api-key.service", () => ({
  getDecryptedRenderApiKey: vi.fn(),
  RenderApiKeyError: class RenderApiKeyError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
}));

import { renderIntegrationRouter } from "./render-integration.route";
import { fetchAccessibleServices } from "../services/providers/render/render-api.service";
import { getDecryptedRenderApiKey, RenderApiKeyError } from "../services/providers/render/render-api-key.service";

beforeEach(() => {
  vi.mocked(fetchAccessibleServices).mockReset();
  vi.mocked(getDecryptedRenderApiKey).mockReset();
});

describe("GET /api/integrations/render/services", () => {
  const handler = getRouteHandler(renderIntegrationRouter, "get", "/api/integrations/render/services");

  it("renvoie 400 si ni apiKey ni apiKeyId ne sont fournis", async () => {
    const res = makeRes();

    await handler({ query: {}, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("utilise la clé en clair fournie directement", async () => {
    vi.mocked(fetchAccessibleServices).mockResolvedValue([{ id: "srv-1" }] as never);
    const res = makeRes();

    await handler({ query: { apiKey: "rnd_123" }, userId: "user-1" } as never, res);

    expect(fetchAccessibleServices).toHaveBeenCalledWith("rnd_123");
    expect(getDecryptedRenderApiKey).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ services: [{ id: "srv-1" }] });
  });

  it("déchiffre la clé stockée si apiKeyId est fourni", async () => {
    vi.mocked(getDecryptedRenderApiKey).mockResolvedValue("rnd_decrypted");
    vi.mocked(fetchAccessibleServices).mockResolvedValue([]);
    const res = makeRes();

    await handler({ query: { apiKeyId: "key-1" }, userId: "user-1" } as never, res);

    expect(getDecryptedRenderApiKey).toHaveBeenCalledWith("user-1", "key-1");
    expect(fetchAccessibleServices).toHaveBeenCalledWith("rnd_decrypted");
  });

  it("propage le code d'erreur d'une RenderApiKeyError", async () => {
    vi.mocked(getDecryptedRenderApiKey).mockRejectedValue(new RenderApiKeyError("Clé introuvable.", 404));
    const res = makeRes();

    await handler({ query: { apiKeyId: "key-inconnue" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("renvoie 502 si l'appel à l'API Render échoue", async () => {
    vi.mocked(fetchAccessibleServices).mockRejectedValue(new Error("boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeRes();

    await handler({ query: { apiKey: "mauvaise-cle" }, userId: "user-1" } as never, res);

    expect(res.status).toHaveBeenCalledWith(502);
    consoleError.mockRestore();
  });
});
