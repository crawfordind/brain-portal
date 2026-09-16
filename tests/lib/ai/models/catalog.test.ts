import { describe, it, expect } from "vitest";
import { normalizeCatalogResponse } from "@/lib/ai/models/catalog";
import { parseModelPreferences } from "@/lib/ai/models";

describe("normalizeCatalogResponse", () => {
  const payload = {
    data: [
      {
        id: "vendor/chat",
        name: "Vendor Chat",
        description: "A chat model",
        context_length: 128000,
        // OpenRouter quotes prices as USD *per token*, as strings.
        pricing: { prompt: "0.0000005", completion: "0.0000015" },
        architecture: { input_modalities: ["text"] },
      },
      {
        id: "vendor/seer",
        name: "Vendor Seer",
        context_length: 2000000,
        pricing: { prompt: "0", completion: "0" },
        architecture: { input_modalities: ["text", "image"] },
      },
    ],
  };

  it("converts per-token prices into per-million, which is what people compare", () => {
    const [chat] = normalizeCatalogResponse(payload);
    expect(chat.promptCostPerMillion).toBeCloseTo(0.5);
    expect(chat.completionCostPerMillion).toBeCloseTo(1.5);
  });

  it("flags image support from input modalities", () => {
    const models = normalizeCatalogResponse(payload);
    expect(models.find((m) => m.id === "vendor/seer")?.supportsVision).toBe(true);
    expect(models.find((m) => m.id === "vendor/chat")?.supportsVision).toBe(false);
  });

  it("reads image support from the older combined modality string", () => {
    const [model] = normalizeCatalogResponse({
      data: [{ id: "old/style", architecture: { modality: "text+image->text" } }],
    });
    expect(model.supportsVision).toBe(true);
  });

  it("keeps free models distinguishable from unpriced ones", () => {
    const models = normalizeCatalogResponse(payload);
    // 0 means free; null means the catalog didn't say. Collapsing them would
    // make a free model look like an unknown-cost one in the picker.
    expect(models.find((m) => m.id === "vendor/seer")?.promptCostPerMillion).toBe(0);
    const [unpriced] = normalizeCatalogResponse({ data: [{ id: "no/price" }] });
    expect(unpriced.promptCostPerMillion).toBeNull();
  });

  it("survives a malformed payload instead of throwing", () => {
    expect(normalizeCatalogResponse(null)).toEqual([]);
    expect(normalizeCatalogResponse({})).toEqual([]);
    expect(normalizeCatalogResponse({ data: "nope" })).toEqual([]);
    expect(normalizeCatalogResponse({ data: [null, { name: "no id" }] })).toEqual([]);
  });

  it("falls back to the id when a model has no display name", () => {
    const [model] = normalizeCatalogResponse({ data: [{ id: "bare/model" }] });
    expect(model.name).toBe("bare/model");
  });
});

describe("parseModelPreferences", () => {
  it("reads saved slot choices out of the preferences blob", () => {
    const prefs = parseModelPreferences(
      JSON.stringify({ theme: "dark", models: { fast: "a/one", deep: "b/two" } })
    );
    expect(prefs).toEqual({ fast: "a/one", deep: "b/two" });
  });

  it("ignores keys that are not real slots", () => {
    const prefs = parseModelPreferences(
      JSON.stringify({ models: { fast: "a/one", nonsense: "b/two" } })
    );
    expect(prefs).toEqual({ fast: "a/one" });
  });

  it("ignores non-string and blank values", () => {
    const prefs = parseModelPreferences(
      JSON.stringify({ models: { fast: 42, deep: "", agent: "  ", vision: " c/three " } })
    );
    expect(prefs).toEqual({ vision: "c/three" });
  });

  it("returns empty for missing or corrupt preferences rather than throwing", () => {
    expect(parseModelPreferences(null)).toEqual({});
    expect(parseModelPreferences("")).toEqual({});
    expect(parseModelPreferences("not json")).toEqual({});
    expect(parseModelPreferences(JSON.stringify({ models: "nope" }))).toEqual({});
    expect(parseModelPreferences(JSON.stringify({ models: ["a"] }))).toEqual({});
  });
});
