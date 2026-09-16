/**
 * Handwriting / sketch recognition.
 *
 * Uses an OpenRouter vision-capable model to transcribe handwritten or printed
 * text from an image (typically a sketch exported from the in-app drawing pad)
 * and to describe any diagrams or non-text content. The result is normalized
 * into a stable {@link HandwritingRecognition} shape regardless of how the
 * model formats its reply.
 */

import { openrouter, parseJSONResponse } from "./client";
import { getModelChain } from "./models";

export interface HandwritingRecognition {
  /** True when any handwritten or printed text was found in the image. */
  hasText: boolean;
  /** Plain-text transcription, preserving line breaks. Empty when no text. */
  text: string;
  /**
   * Markdown reconstruction of the content when structure is detectable
   * (headings, bullet/numbered lists, checkboxes, tables). Falls back to the
   * plain text when no richer structure is present.
   */
  markdown: string;
  /** Short description of diagrams, drawings, or other non-text content. */
  description: string;
  /** Model's self-reported confidence in the transcription, 0..1. */
  confidence: number;
}

const SYSTEM_PROMPT = `You are a precise OCR and handwriting-recognition engine for a note-taking app.

You will be given an image that is usually a hand-drawn sketch or handwritten note. Your job is to:
1. Transcribe ALL handwritten and printed text exactly as written, preserving line breaks and reading order (top-to-bottom, left-to-right).
2. Reconstruct structure as Markdown when it is clearly present: headings, bullet lists (-), numbered lists, checkboxes (- [ ] / - [x]), and tables.
3. Briefly describe any diagrams, arrows, shapes, or drawings that are NOT text.

Rules:
- Do NOT invent text that is not in the image. If a word is illegible, transcribe your best guess and lower your confidence.
- If there is no text at all, set hasText to false and leave text/markdown empty, but still describe the drawing.
- Keep the description to one or two sentences.

Respond with ONLY a JSON object of this exact shape:
{
  "hasText": boolean,
  "text": string,        // plain transcription, "\\n" between lines
  "markdown": string,    // structured markdown, or same as text if no structure
  "description": string, // short description of non-text content
  "confidence": number   // 0..1
}`;

interface RawRecognition {
  hasText?: boolean;
  has_text?: boolean;
  text?: string;
  markdown?: string;
  description?: string;
  confidence?: number;
}

/**
 * Coerce a raw model response object into a well-formed {@link HandwritingRecognition}.
 * Exported for unit testing — it performs no I/O.
 */
export function normalizeRecognition(raw: RawRecognition): HandwritingRecognition {
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  const markdown =
    typeof raw.markdown === "string" && raw.markdown.trim()
      ? raw.markdown.trim()
      : text;
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";

  const hasTextFlag =
    typeof raw.hasText === "boolean"
      ? raw.hasText
      : typeof raw.has_text === "boolean"
      ? raw.has_text
      : undefined;
  const hasText = hasTextFlag ?? text.length > 0;

  let confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? raw.confidence
      : 0.5;
  // Some models report 0..100 — normalize to 0..1.
  if (confidence > 1) confidence = confidence / 100;
  confidence = Math.max(0, Math.min(1, confidence));

  return { hasText, text, markdown, description, confidence };
}

/**
 * Recognize handwriting / text in an image.
 *
 * @param imageUrl A data URL (`data:image/png;base64,...`) or a publicly
 *   reachable image URL. The vision model accepts either.
 */
export async function recognizeHandwriting(
  imageUrl: string,
  options: { model?: string; userId?: string | null; maxTokens?: number } = {}
): Promise<HandwritingRecognition> {
  const { maxTokens = 1500 } = options;

  // Resolved per call rather than pinned at module load: the vision slot
  // reflects the user's setting, drops ids OpenRouter has retired, and carries
  // fallbacks so a sketch still transcribes when the first choice is down.
  const chain = options.model
    ? [options.model]
    : await getModelChain("vision", options.userId);

  const response = await openrouter.chat.completions.create({
    model: chain[0],
    ...(chain.length > 1 ? { models: chain } : {}),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transcribe and describe this image. Respond with JSON only.",
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    const raw = parseJSONResponse<RawRecognition>(content);
    return normalizeRecognition(raw);
  } catch {
    // Model didn't return JSON — treat the whole reply as the transcription.
    const text = content.trim();
    return normalizeRecognition({ text, confidence: text ? 0.4 : 0 });
  }
}
