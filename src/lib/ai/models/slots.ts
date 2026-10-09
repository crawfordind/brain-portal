/**
 * Model slots — the jobs this app actually asks a model to do.
 *
 * Before this, model ids were scattered across the codebase as module
 * constants (`DEFAULT_MODEL`, `MINIMAX_MODEL`) and bare string literals in
 * half a dozen files. When a provider retired one of those ids, the only
 * symptom was a subsystem quietly failing, and fixing it meant a code change
 * and a redeploy.
 *
 * A slot names the *job* instead of the model — "the fast one we use for tags
 * and summaries" — so the model behind it becomes configuration. Each slot
 * carries an ordered list of candidates; resolution (see `resolve.ts`) keeps
 * the first candidate the live OpenRouter catalog actually offers, which is
 * what makes a retired id heal itself rather than break a feature.
 *
 * Pure data, no imports: safe in the browser, on the server, and in tests.
 */

export const MODEL_SLOTS = [
  "fast",
  "deep",
  "agent",
  "vision",
  "embedding",
] as const;

export type ModelSlot = (typeof MODEL_SLOTS)[number];

/**
 * OpenRouter's Auto Router. It classifies the prompt and picks a live model,
 * so it cannot 404 the way a pinned id can. Every chat chain ends here — it is
 * the reason a request can degrade instead of failing.
 */
export const AUTO_ROUTER_MODEL = "openrouter/auto";

export interface SlotDefinition {
  slot: ModelSlot;
  /** Shown as the setting's name. */
  label: string;
  /** What the model is being asked to do, in the user's terms. */
  description: string;
  /** The features that break if this slot is broken. */
  usedFor: string[];
  /**
   * Candidates in preference order. These are *preferences*, not promises:
   * resolution keeps only the ones present in the live catalog, so an id that
   * a provider retires simply drops out and the next one takes over.
   */
  candidates: string[];
  /** Why the top candidate is the default, shown next to the "Recommended" badge. */
  recommendationReason: string;
  /**
   * Chat slots fall back to the Auto Router. Embeddings do not — that is a
   * different endpoint with a fixed vector width, and silently swapping it
   * would make new vectors incomparable with every stored one.
   */
  autoRouterEligible: boolean;
  /** Only models advertising image input may fill this slot. */
  requiresVision?: boolean;
}

export const SLOT_DEFINITIONS: Record<ModelSlot, SlotDefinition> = {
  fast: {
    slot: "fast",
    label: "Everyday tasks",
    description:
      "The workhorse. Runs constantly in the background, so it should be quick and cheap rather than clever.",
    usedFor: [
      "Note summaries and auto-tagging",
      "Sorting captures in your inbox",
      "Reading dates and priorities out of typed tasks",
      "Choosing which AI agent gets a delegated job",
    ],
    candidates: [
      "x-ai/grok-4.1-fast",
      "x-ai/grok-4-fast",
      "google/gemini-2.5-flash",
      "openai/gpt-4.1-mini",
      "anthropic/claude-haiku-4.5",
    ],
    recommendationReason:
      "Fast and inexpensive, with a large enough context window for whole notes.",
    autoRouterEligible: true,
  },

  deep: {
    slot: "deep",
    label: "Deep thinking",
    description:
      "Used sparingly, for the work you actually read. Worth spending more on quality here.",
    usedFor: [
      "Insights and connections across your notes",
      "Weekly reviews",
      "Project health reports",
    ],
    candidates: [
      "minimax/minimax-m2.7",
      "minimax/minimax-m2.5",
      "x-ai/grok-4.5",
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5",
    ],
    recommendationReason:
      "Planning-optimized and token-efficient on long, multi-step synthesis.",
    autoRouterEligible: true,
  },

  agent: {
    slot: "agent",
    label: "AI agents",
    description:
      "The default for delegated work. Individual agents can still pin their own model, which overrides this.",
    usedFor: [
      "Every one of the 17 specialist agents",
      "Revisions when you ask an agent to try again",
    ],
    candidates: [
      "minimax/minimax-m2.7",
      "minimax/minimax-m2.5",
      "anthropic/claude-sonnet-4.5",
      "x-ai/grok-4.5",
      "openai/gpt-5",
    ],
    recommendationReason:
      "Strong at long-form structured output, which is what agent deliverables are.",
    autoRouterEligible: true,
  },

  vision: {
    slot: "vision",
    label: "Handwriting and images",
    description:
      "Needs to accept images, not just text. Only image-capable models are offered here.",
    usedFor: [
      "Turning sketches and handwriting into text",
      "Describing uploaded images",
      "Pulling text out of screenshots",
    ],
    candidates: [
      "google/gemini-2.5-flash",
      "x-ai/grok-4.1-fast",
      "openai/gpt-4.1-mini",
      "anthropic/claude-sonnet-4.5",
    ],
    recommendationReason:
      "Accurate on handwriting at a price that suits per-sketch use.",
    autoRouterEligible: true,
    requiresVision: true,
  },

  embedding: {
    slot: "embedding",
    label: "Search index",
    description:
      "Turns your notes into vectors for semantic search. Changing this makes new notes incomparable with old ones until everything is re-indexed.",
    usedFor: [
      "Semantic search",
      "Finding related notes",
      "Automatic connections between notes",
    ],
    candidates: [
      "openai/text-embedding-3-small",
      "openai/text-embedding-3-large",
    ],
    recommendationReason:
      "1536 dimensions, matching every vector already stored in this database.",
    // Deliberately no Auto Router: see SlotDefinition.autoRouterEligible.
    autoRouterEligible: false,
  },
};

export function isModelSlot(value: unknown): value is ModelSlot {
  return typeof value === "string" && (MODEL_SLOTS as readonly string[]).includes(value);
}

/**
 * Environment overrides, kept working so existing deployments don't change
 * behavior on upgrade. A saved user preference outranks these; see `resolve.ts`.
 */
export function envOverrideForSlot(slot: ModelSlot): string | null {
  switch (slot) {
    case "fast":
      return process.env.OPENROUTER_MODEL || null;
    case "vision":
      return process.env.OPENROUTER_VISION_MODEL || null;
    case "embedding":
      return process.env.OPENROUTER_EMBEDDING_MODEL || null;
    default:
      return null;
  }
}
