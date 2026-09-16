/**
 * Model selection API.
 *
 * GET  /api/models  — the live OpenRouter catalog, what each slot currently
 *                     resolves to, and what we recommend for each job.
 * PUT  /api/models   — save the user's per-slot choices.
 *
 * The catalog is fetched live rather than hardcoded, because "which models
 * exist" is exactly the fact that goes stale in a repo.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  MODEL_SLOTS,
  SLOT_DEFINITIONS,
  fetchModelCatalog,
  getModelPreferences,
  recommendedModel,
  resolveAllSlots,
  selectableModels,
  setModelPreferences,
  type ModelSlot,
} from "@/lib/ai/models";
import { isModelSlot } from "@/lib/ai/models/slots";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const refresh = request.nextUrl.searchParams.get("refresh") === "true";

  try {
    if (refresh) await fetchModelCatalog({ force: true });

    const [{ catalog, resolved }, preferences] = await Promise.all([
      resolveAllSlots(user.id),
      getModelPreferences(user.id),
    ]);

    const slots = MODEL_SLOTS.map((slot) => {
      const definition = SLOT_DEFINITIONS[slot];
      const options = catalog.live
        ? selectableModels(slot, catalog.ids, catalog.visionIds)
        : [];

      return {
        slot,
        label: definition.label,
        description: definition.description,
        usedFor: definition.usedFor,
        recommendationReason: definition.recommendationReason,
        recommended: recommendedModel(
          slot,
          catalog.live ? catalog.ids : null,
          catalog.live ? catalog.visionIds : null
        ),
        selected: preferences[slot] ?? null,
        resolved: resolved[slot],
        /** Ids the user may choose for this slot, already filtered by capability. */
        options,
      };
    });

    return NextResponse.json(
      {
        slots,
        // The full catalog powers the picker's search and its price/context
        // labels. It is public data from OpenRouter, so nothing here is secret.
        models: catalog.models,
        catalog: {
          live: catalog.live,
          fetchedAt: catalog.fetchedAt,
          count: catalog.models.length,
          ...(catalog.error ? { error: catalog.error } : {}),
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[API] GET /api/models failed:", error);
    return NextResponse.json({ error: "Failed to load models" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;

  const rawUpdates = body.models;
  if (!rawUpdates || typeof rawUpdates !== "object" || Array.isArray(rawUpdates)) {
    return NextResponse.json(
      { error: "Body must be { models: { <slot>: <model id or null> } }" },
      { status: 400 }
    );
  }

  const updates: Partial<Record<ModelSlot, string | null>> = {};
  for (const [slot, value] of Object.entries(rawUpdates as Record<string, unknown>)) {
    if (!isModelSlot(slot)) {
      return NextResponse.json({ error: `Unknown slot: ${slot}` }, { status: 400 });
    }
    if (value === null || value === "") {
      updates[slot] = null; // back to the recommended default
      continue;
    }
    if (typeof value !== "string") {
      return NextResponse.json(
        { error: `Model for ${slot} must be a string or null` },
        { status: 400 }
      );
    }
    updates[slot] = value;
  }

  try {
    // Validated against the live catalog, so a typo is caught at save time
    // rather than surfacing later as a failed background job. A catalog we
    // could not fetch is not evidence of anything, so it skips validation.
    const catalog = await fetchModelCatalog();
    if (catalog.live) {
      for (const [slot, value] of Object.entries(updates)) {
        if (!value) continue;
        if (!catalog.ids.has(value)) {
          return NextResponse.json(
            { error: `OpenRouter does not currently offer "${value}"` },
            { status: 400 }
          );
        }
        if (SLOT_DEFINITIONS[slot as ModelSlot].requiresVision && !catalog.visionIds.has(value)) {
          return NextResponse.json(
            { error: `"${value}" cannot accept images, so it can't handle ${slot} work` },
            { status: 400 }
          );
        }
      }
    }

    const saved = await setModelPreferences(user.id, updates);
    const { resolved } = await resolveAllSlots(user.id);

    return NextResponse.json({ models: saved, resolved });
  } catch (error) {
    console.error("[API] PUT /api/models failed:", error);
    return NextResponse.json({ error: "Failed to save model choices" }, { status: 500 });
  }
}
