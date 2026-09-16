import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } };
  },
}));

import {
  completeWithMeta,
  isModelUnavailableError,
  wireFallbackModels,
} from "@/lib/ai/client";
import { AUTO_ROUTER_MODEL } from "@/lib/ai/models/slots";

function ok(content: string, model = "served-model") {
  return { model, choices: [{ message: { content }, finish_reason: "stop" }] };
}

function err(message: string, status?: number) {
  const e = new Error(message) as Error & { status?: number };
  if (status !== undefined) e.status = status;
  return e;
}

describe("isModelUnavailableError", () => {
  it("recognizes the ways a provider says a model is gone", () => {
    for (const message of [
      "404 No endpoints found for vendor/old-model",
      "vendor/x is not a valid model ID",
      "This model has been deprecated",
      "Model not found",
      "The model does not exist",
      "unknown model: vendor/typo",
      "No allowed providers are available for the selected model",
      "vendor/x was decommissioned",
    ]) {
      expect(isModelUnavailableError(err(message)), message).toBe(true);
    }
  });

  it("treats a bare 404 as the model being gone", () => {
    expect(isModelUnavailableError(err("Not Found", 404))).toBe(true);
  });

  it("does NOT mistake a transient provider outage for a retired model", () => {
    // The app wraps envelope errors as "Upstream model error: <provider text>".
    // A loose pattern anchored on the word "model" matches this and would
    // abandon a working model on a momentary blip.
    expect(isModelUnavailableError(err("Upstream model error: provider unavailable"))).toBe(false);
    expect(isModelUnavailableError(err("HTTP 502"))).toBe(false);
    expect(isModelUnavailableError(err("Rate limit exceeded", 429))).toBe(false);
    expect(isModelUnavailableError(err("Request timed out"))).toBe(false);
  });

  it("handles non-Error values without throwing", () => {
    expect(isModelUnavailableError(null)).toBe(false);
    expect(isModelUnavailableError(undefined)).toBe(false);
    expect(isModelUnavailableError("model not found")).toBe(true);
  });
});

describe("completeWithMeta — the model was retired", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls through to the next model instead of failing the request", async () => {
    mockCreate
      .mockRejectedValueOnce(err("No endpoints found for vendor/retired"))
      .mockResolvedValueOnce(ok("second model answered"));

    const result = await completeWithMeta("prompt", {
      models: ["vendor/retired", "vendor/live"],
      allowAutoFallback: false,
    });

    expect(result.content).toBe("second model answered");
    expect(result.skippedModels).toEqual(["vendor/retired"]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("lands on the Auto Router when every configured model is gone", async () => {
    mockCreate
      .mockRejectedValueOnce(err("model not found"))
      .mockRejectedValueOnce(err("model not found"))
      .mockResolvedValueOnce(ok("auto router answered"));

    const result = await completeWithMeta("prompt", {
      models: ["vendor/gone-a", "vendor/gone-b"],
    });

    expect(result.content).toBe("auto router answered");
    expect(mockCreate).toHaveBeenCalledTimes(3);
    // The last attempt is the one that cannot 404.
    const lastCall = mockCreate.mock.calls[2][0] as { model: string };
    expect(lastCall.model).toBe(AUTO_ROUTER_MODEL);
  });

  it("does not waste the retry budget on a model that no longer exists", async () => {
    mockCreate
      .mockRejectedValueOnce(err("is not a valid model ID"))
      .mockResolvedValueOnce(ok("recovered"));

    await completeWithMeta("prompt", {
      models: ["vendor/gone", "vendor/live"],
      retries: 3,
      retryDelayMs: 1,
      allowAutoFallback: false,
    });

    // One attempt on the dead model, not four.
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

describe("completeWithMeta — chain construction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("appends the Auto Router to an explicit model so nothing is a dead end", async () => {
    mockCreate.mockResolvedValueOnce(ok("fine"));

    await completeWithMeta("prompt", { model: "vendor/pinned" });

    const call = mockCreate.mock.calls[0][0] as { model: string; models?: string[] };
    expect(call.model).toBe("vendor/pinned");
    expect(call.models).toEqual(["vendor/pinned", AUTO_ROUTER_MODEL]);
  });

  it("hands OpenRouter the head of the chain for server-side failover", async () => {
    mockCreate.mockResolvedValueOnce(ok("fine"));

    await completeWithMeta("prompt", { models: ["a/one", "b/two", "c/three"] });

    // Only the first three go on the wire — OpenRouter rejects a longer
    // `models` array outright. The Auto Router is still appended to the
    // in-memory chain and is reached by the client-side walk below.
    const call = mockCreate.mock.calls[0][0] as { models?: string[] };
    expect(call.models).toEqual(["a/one", "b/two", "c/three"]);
  });

  it("still walks to the Auto Router even though it was cut from the wire array", async () => {
    // The chain is [a, b, c, auto]; a, b and c are all retired. Reaching the
    // Auto Router proves the client-side walk covers what the 3-item window
    // cannot advertise.
    mockCreate
      .mockRejectedValueOnce(err("404 No endpoints found for a/one"))
      .mockRejectedValueOnce(err("404 No endpoints found for b/two"))
      .mockRejectedValueOnce(err("404 No endpoints found for c/three"))
      .mockResolvedValueOnce(ok("rescued"));

    const result = await completeWithMeta("prompt", {
      models: ["a/one", "b/two", "c/three"],
    });

    expect(result.content).toBe("rescued");
    const finalCall = mockCreate.mock.calls[3][0] as { model: string };
    expect(finalCall.model).toBe(AUTO_ROUTER_MODEL);
  });

  it("omits the models array when there is only one option", async () => {
    mockCreate.mockResolvedValueOnce(ok("fine"));

    await completeWithMeta("prompt", {
      model: "vendor/only",
      allowAutoFallback: false,
    });

    const call = mockCreate.mock.calls[0][0] as { models?: string[] };
    expect(call.models).toBeUndefined();
  });

  it("drops duplicates so a model is never tried twice in a row", async () => {
    mockCreate.mockResolvedValueOnce(ok("fine"));

    await completeWithMeta("prompt", { models: ["a/one", "a/one", "b/two"] });

    const call = mockCreate.mock.calls[0][0] as { models?: string[] };
    expect(call.models).toEqual(["a/one", "b/two", AUTO_ROUTER_MODEL]);
  });

  it("respects allowAutoFallback: false for callers testing one model", async () => {
    mockCreate.mockRejectedValue(err("model not found"));

    await expect(
      completeWithMeta("prompt", { model: "vendor/gone", allowAutoFallback: false })
    ).rejects.toThrow(/model not found/);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

/**
 * Regression: the first build sent the whole fallback chain as OpenRouter's
 * `models` array. OpenRouter caps that array at three, so every request with a
 * long chain came back as
 *   400 'models' array must have 3 items or fewer
 * and the agent queue failed wholesale. The chain itself may be longer — the
 * client-side walk uses all of it — but a single request may only advertise
 * three.
 */
describe("wireFallbackModels — OpenRouter's array limit", () => {
  it("never sends more than three models", () => {
    const chain = ["a/1", "b/2", "c/3", "d/4", "openrouter/auto"];
    expect(wireFallbackModels(chain)).toEqual(["a/1", "b/2", "c/3"]);
  });

  it("passes a short chain through untouched", () => {
    expect(wireFallbackModels(["a/1", "b/2"])).toEqual(["a/1", "b/2"]);
  });

  it("omits the parameter entirely when there is nothing to fall back to", () => {
    // A one-element array would be pointless payload on every single request.
    expect(wireFallbackModels(["a/1"])).toBeUndefined();
    expect(wireFallbackModels([])).toBeUndefined();
  });

  it("keeps the primary model first, so the window is the head of the chain", () => {
    const chain = ["primary/model", "second/model", "third/model", "fourth/model"];
    expect(wireFallbackModels(chain)?.[0]).toBe("primary/model");
  });
});
