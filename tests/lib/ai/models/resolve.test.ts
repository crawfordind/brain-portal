import { describe, it, expect } from "vitest";
import {
  resolveSlot,
  recommendedModel,
  selectableModels,
} from "@/lib/ai/models/resolve";
import { AUTO_ROUTER_MODEL, SLOT_DEFINITIONS } from "@/lib/ai/models/slots";

const catalog = (...ids: string[]) => new Set(ids);

describe("resolveSlot — the deprecation problem", () => {
  it("drops a retired default and uses the next live candidate", () => {
    const [first, second] = SLOT_DEFINITIONS.fast.candidates;
    const result = resolveSlot({
      slot: "fast",
      availableIds: catalog(second), // `first` has been retired
    });

    expect(result.primary).toBe(second);
    expect(result.chain).not.toContain(first);
  });

  it("drops the user's own choice when the provider retires it, and says so", () => {
    const live = SLOT_DEFINITIONS.fast.candidates[0];
    const result = resolveSlot({
      slot: "fast",
      userChoice: "vendor/model-that-was-sunset",
      availableIds: catalog(live),
    });

    // The point: it heals instead of failing, and Settings can explain why.
    expect(result.primary).toBe(live);
    expect(result.retiredSelection).toBe("vendor/model-that-was-sunset");
    expect(result.source).toBe("default");
  });

  it("honours a live user choice over the recommended default", () => {
    const [recommended, alternative] = SLOT_DEFINITIONS.fast.candidates;
    const result = resolveSlot({
      slot: "fast",
      userChoice: alternative,
      availableIds: catalog(recommended, alternative),
    });

    expect(result.primary).toBe(alternative);
    expect(result.source).toBe("user");
    expect(result.retiredSelection).toBeUndefined();
  });

  it("prefers a user choice over an environment override", () => {
    const [a, b] = SLOT_DEFINITIONS.fast.candidates;
    const result = resolveSlot({
      slot: "fast",
      userChoice: b,
      envChoice: a,
      availableIds: catalog(a, b),
    });

    expect(result.primary).toBe(b);
    expect(result.source).toBe("user");
  });

  it("falls back to the environment override when the user has chosen nothing", () => {
    const result = resolveSlot({
      slot: "fast",
      envChoice: "vendor/pinned-by-ops",
      availableIds: catalog("vendor/pinned-by-ops", ...SLOT_DEFINITIONS.fast.candidates),
    });

    expect(result.primary).toBe("vendor/pinned-by-ops");
    expect(result.source).toBe("environment");
  });
});

describe("resolveSlot — never failing", () => {
  it("ends every chat chain at the Auto Router", () => {
    for (const slot of ["fast", "deep", "agent", "vision"] as const) {
      const result = resolveSlot({ slot, availableIds: catalog(AUTO_ROUTER_MODEL) });
      expect(result.chain[result.chain.length - 1]).toBe(AUTO_ROUTER_MODEL);
    }
  });

  it("survives a catalog in which nothing we know about exists", () => {
    const result = resolveSlot({
      slot: "deep",
      userChoice: "gone/away",
      availableIds: catalog("something/unrelated"),
    });

    expect(result.primary).toBe(AUTO_ROUTER_MODEL);
    expect(result.source).toBe("auto");
    expect(result.chain).toHaveLength(1);
  });

  it("never returns an empty chain, for any slot", () => {
    for (const slot of Object.keys(SLOT_DEFINITIONS) as (keyof typeof SLOT_DEFINITIONS)[]) {
      const result = resolveSlot({ slot, availableIds: catalog() });
      expect(result.chain.length).toBeGreaterThan(0);
      expect(result.primary).toBeTruthy();
    }
  });

  it("keeps more than one option when the catalog is healthy", () => {
    const result = resolveSlot({
      slot: "fast",
      availableIds: catalog(...SLOT_DEFINITIONS.fast.candidates),
    });

    expect(result.chain.length).toBeGreaterThan(1);
    expect(new Set(result.chain).size).toBe(result.chain.length); // no duplicates
  });
});

describe("resolveSlot — a failed catalog fetch is not a deprecation", () => {
  it("trusts configured ids when the catalog is unavailable", () => {
    const result = resolveSlot({
      slot: "fast",
      userChoice: "vendor/user-pick",
      availableIds: null,
    });

    // Losing the network must not silently demote a working deployment.
    expect(result.primary).toBe("vendor/user-pick");
    expect(result.source).toBe("user");
    expect(result.retiredSelection).toBeUndefined();
  });
});

describe("resolveSlot — embeddings are special", () => {
  it("never routes embeddings through the Auto Router", () => {
    const result = resolveSlot({ slot: "embedding", availableIds: catalog() });

    // A text model cannot stand in for an embedding model; pretending
    // otherwise would poison the vector index.
    expect(result.chain).not.toContain(AUTO_ROUTER_MODEL);
    expect(result.source).toBe("unresolved");
  });

  it("uses a live embedding model when one is offered", () => {
    const expected = SLOT_DEFINITIONS.embedding.candidates[0];
    const result = resolveSlot({ slot: "embedding", availableIds: catalog(expected) });

    expect(result.primary).toBe(expected);
    expect(result.source).toBe("default");
  });
});

describe("resolveSlot — vision needs actual image support", () => {
  it("skips a listed model that cannot accept images", () => {
    const [textOnly, imageCapable] = SLOT_DEFINITIONS.vision.candidates;
    const result = resolveSlot({
      slot: "vision",
      availableIds: catalog(textOnly, imageCapable),
      visionCapableIds: catalog(imageCapable),
    });

    expect(result.primary).toBe(imageCapable);
  });

  it("rejects a user choice that cannot see", () => {
    const imageCapable = SLOT_DEFINITIONS.vision.candidates[1];
    const result = resolveSlot({
      slot: "vision",
      userChoice: "vendor/text-only",
      availableIds: catalog("vendor/text-only", imageCapable),
      visionCapableIds: catalog(imageCapable),
    });

    expect(result.primary).toBe(imageCapable);
    expect(result.retiredSelection).toBe("vendor/text-only");
  });
});

describe("recommendedModel", () => {
  it("recommends the best candidate that currently exists", () => {
    const [first, second] = SLOT_DEFINITIONS.deep.candidates;
    expect(recommendedModel("deep", catalog(first, second))).toBe(first);
    expect(recommendedModel("deep", catalog(second))).toBe(second);
  });

  it("returns null when none of the candidates survive", () => {
    expect(recommendedModel("deep", catalog("nothing/relevant"))).toBeNull();
  });
});

describe("selectableModels", () => {
  it("offers only embedding models for the search-index slot", () => {
    const options = selectableModels(
      "embedding",
      catalog("openai/text-embedding-3-small", "x-ai/grok-4.1-fast")
    );
    expect(options).toEqual(["openai/text-embedding-3-small"]);
  });

  it("keeps embedding models out of chat slots", () => {
    const options = selectableModels(
      "fast",
      catalog("openai/text-embedding-3-small", "x-ai/grok-4.1-fast")
    );
    expect(options).toEqual(["x-ai/grok-4.1-fast"]);
  });

  it("offers only image-capable models for the vision slot", () => {
    const options = selectableModels(
      "vision",
      catalog("vendor/sees", "vendor/blind"),
      catalog("vendor/sees")
    );
    expect(options).toEqual(["vendor/sees"]);
  });

  it("does not offer the Auto Router where it cannot be used", () => {
    expect(
      selectableModels("embedding", catalog(AUTO_ROUTER_MODEL, "openai/text-embedding-3-small"))
    ).not.toContain(AUTO_ROUTER_MODEL);
    expect(
      selectableModels("fast", catalog(AUTO_ROUTER_MODEL, "x-ai/grok-4.1-fast"))
    ).toContain(AUTO_ROUTER_MODEL);
  });
});
