# Note Lenses: fluid views of a note

**Status:** Phase 1 built (this PR). Phases 2–4 are proposals.

## The idea

A note is where thinking goes in: a brain dump, a meeting transcript, pasted
markdown. It is rarely the best way to get something *back out*. Twelve months
of numbers read better as a line, a list of dates reads better as a timeline,
and a meeting's action items read better as a checklist you can tick.

Note Lenses sense the data inside a note and offer it back as other views. The
raw note is always the first view and always the source of truth. You swipe
(or tap a tab) across to see the lenses:

```
 [ Note ] [ To do ] [ Signups ] [ Budget ] [ Timeline ] [ Key numbers ] …   ✨ Read deeper
 ───────────────────────────────────────────────────────────────────────
  Signups
  6 values over time, Apr to Sep. A line shows the trend and where it turned.
   1,500 ┤                                        ╱
   1,000 ┤                        ╱‾‾‾‾‾‾‾‾‾‾╱
     500 ┤  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲___╱
         Apr     May     Jun     Jul     Aug     Sep
```

Over time the goal is that the lenses, not the raw text, become where you go
to use a note, while the note stays there to add to.

## Key terms

- **Signal**: a piece of structured data found in a note: a series of numbers,
  a dated item, a checkbox, a `key: value` detail, a table, a heading.
- **Lens**: a view built from signals: chart, timeline, checklist, stat tiles,
  table, fact card, outline, suggested next steps.
- **Sensing**: note → signals. Rules, no model, runs as you type.
- **Choosing**: signals → lenses. Rules, no model, always the same answer.
- **Read deeper**: an optional model read that adds signals from loose prose.

## The one design decision that matters

> **The model reads. Rules choose.**

The request was for the LLM to "determine deterministically" which view helps
most. A model cannot be deterministic, but the part that has to be (which
chart does this data get?) does not need a model. So the work is split:

| Step | Who | Why |
|---|---|---|
| Find data in tidy notes | Rules (`sense.ts`) | Free, instant, updates as you type |
| Find data in messy notes | Model (`ai-extract.ts`) | Only a model can read a transcript |
| Pick the view | Rules (`choose.ts`) | Same data, same chart, every time, with a stated reason |

A model-read transcript and a hand-typed list with the same numbers get the
same chart. Every lens says in one sentence why it exists ("6 values over time.
A line shows the trend."), which is only possible because the choice is a rule.

### The rules

| The data | The lens | Reason shown |
|---|---|---|
| 3+ numbers over time (months, quarters, years, weeks, dates) | Line | shows trend and turning points |
| 3+ amounts across categories | Bars, biggest first | compare magnitude |
| …with an order in the labels (Stage 1, Step 2) | Bars, written order | keep the sequence |
| Percentages summing to ~100% | Share bars on a 0–100 scale | part of a whole |
| 2–8 standalone numbers | Stat tiles | a number isn't a chart |
| Dated lines (2+, or any deadline) | Timeline: Today / Next 7 days / Later / Past | what's next |
| Checkboxes, `TODO:` / `Action:` lines | Checklist with progress | what's open |
| Tables | Sortable table (plus a chart when numeric) | same data, two views |
| `key: value` details | Fact card | quick reference |
| 2+ headed sections | Section cards | skim the structure |
| Model-suggested next steps | Next steps (never auto-created) | what to do |

Charts follow standard data-viz practice: one axis, one hue for a single
series (the theme's primary), thin marks, a hover/touch crosshair on lines,
visible values on bars, and a "Show as table" view on every chart.

## Phase 1: built in this PR

**Engine** (`src/lib/lenses/`, pure, unit-tested):

- `blocks.ts`: TipTap HTML *and* markdown → one block list. Regex-based like
  `annotations/extract.ts`, so it runs server-side too. Also
  `setTaskChecked`, which writes a tick back into either dialect.
- `sense.ts`: blocks → signals. Numbers with currency, scale and units
  (`$1.2M`, `45%`, `12 hrs`); time-label detection; dates via `chrono-node`
  relative to the note's creation day; newest-first series are reversed.
- `choose.ts`: signals → up to 10 lenses by the rules above. `mergeSignals`
  folds a model read in without duplicating what the note already says.
- `ai-extract.ts`: the model prompt plus `normalizeDeepRead`, which validates
  each item on its own with zod, so one malformed entry costs that entry, not
  the read.
- `fingerprint.ts`: FNV-1a of the body, the same value in browser and server,
  used to tell whether a cached model read is from an older draft.

**API**: `GET /api/notes/[id]/lenses?fingerprint=` (cache only, never calls a
model) and `POST` (runs the read, `full_llm` slot). Cached in `ai_cache` per
(note, fingerprint) for 30 days. Owner-only, like `/analyze`.

**UI**: `NoteLenses` wraps the editor on the note page. Nothing changes for a
note with nothing to show: no tab strip appears.

- The editor stays mounted (and is not placed in a scroll container, which
  would break its sticky toolbar); lenses slide in beside it.
- Swipe is a strict flick (fast, long, clearly sideways) and is ignored on
  tables, charts, inputs and while text is selected.
- **Acting from a lens**: tick a checkbox and the note updates (and autosaves);
  turn a checklist item, a timeline date or a suggestion into a real task
  linked to the note; sort tables; switch a chart's measure.
- **Pin a lens** to open the note there by default. Per device, in
  `localStorage`, like stream density.

## Phase 2: arrange (proposal)

"Users can move things around." Turn the lens strip into a **note dashboard**:
a grid of lens cards the user can drag, resize and hide (`@dnd-kit` is already
a dependency). The layout is saved per note in `notes.metadata.lenses`
(`{ order, hidden, sizes }`), so it follows the user across devices, unlike the
per-device pin. Lens ids are already stable (`checklist`, `chart-0`) for this.

Open questions: does a layout survive a note whose shape changes (a new chart
appears)? Proposed: new lenses append at the end; removed ones drop silently.

## Phase 3: transcripts in, documents out (proposal)

- **In**: a "Paste or record a meeting" entry that creates a note from a
  transcript (Voice input already exists) and runs Read deeper automatically.
  The first automatic model call in this feature, so it should be opt-in.
- **Out: document types.** The same signals rendered as a *document*: meeting
  minutes (summary, decisions, actions, dates), a one-page brief, a project
  plan. These are templates over signals, so they stay deterministic.
- **Calendar**: timeline items to Google Calendar events (connector exists).

## Phase 4: more lenses (proposal)

- Multi-series line and grouped bars (categorical palette, validated for
  colour-blind safety, direct labels at ≤4 series).
- People lens: who is mentioned and what's owed to whom, from the CRM entity
  layer that already extracts contacts from notes.
- Calendar heatmap for daily logs (habit or journal notes).
- Write-back for more than checkboxes: editing a fact or a table cell in a lens
  edits the note.

## Deliberately not done

- **No automatic model calls.** Rules run on every keystroke; the model runs
  only on a tap, and the result is cached. A note with nothing structured
  costs nothing and looks exactly as it did.
- **No new tables, no migration.** Cache is `ai_cache`; the pin is
  `localStorage`.
- **No chart library.** Two chart forms did not justify a dependency; the
  line is ~150 lines of SVG, the bars are CSS.
