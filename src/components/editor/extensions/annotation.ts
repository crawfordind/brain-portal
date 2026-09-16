import { Mark, mergeAttributes } from "@tiptap/core";
import {
  ANNOTATION_INTENTS,
  annotationClass,
  getAnnotationIntent,
  isAnnotationIntentId,
  type AnnotationIntentId,
} from "@/lib/annotations/intents";

/**
 * Semantic highlight mark.
 *
 * Renders as `<mark data-intent="expand" class="bp-annotation bp-annotation-expand">`.
 * Both carriers are deliberate: the data attribute is what the prompt builder
 * reads, and the class is what survives a sanitizer configured with
 * `ALLOW_DATA_ATTR: false` — so the colour never goes missing in a shared or
 * exported view even if the attribute does.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    annotation: {
      /** Highlight the selection with the given meaning. */
      setAnnotation: (intent: AnnotationIntentId, comment?: string | null) => ReturnType;
      /** Highlight, or clear it if the selection already carries that meaning. */
      toggleAnnotation: (intent: AnnotationIntentId) => ReturnType;
      /** Remove any highlight from the selection. */
      unsetAnnotation: () => ReturnType;
      /** Attach (or with null, clear) a note on the highlight under the cursor. */
      setAnnotationComment: (comment: string | null) => ReturnType;
    };
  }
}

export const Annotation = Mark.create({
  name: "annotation",

  // A highlight is about a passage, not about characters typed next: without
  // this, continuing to type at the edge of a highlight silently extends it.
  inclusive: false,

  // Colour is the whole point — let it coexist with bold/italic/links.
  excludes: "",

  addAttributes() {
    return {
      intent: {
        default: null,
        parseHTML: (element) => {
          const fromAttr = element.getAttribute("data-intent");
          if (isAnnotationIntentId(fromAttr)) return fromAttr;
          const fromClass = element.getAttribute("class")?.match(/\bbp-annotation-([a-z-]+)/)?.[1];
          return isAnnotationIntentId(fromClass) ? fromClass : null;
        },
        renderHTML: (attributes) => {
          const intent = getAnnotationIntent(attributes.intent as string | null);
          if (!intent) return {};
          return {
            "data-intent": intent.id,
            class: annotationClass(intent.id),
            // Hovering a highlight should answer "what did I mean by this?".
            title: `${intent.label} — ${intent.meaning}`,
          };
        },
      },
      comment: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-note") || null,
        renderHTML: (attributes) =>
          attributes.comment ? { "data-note": attributes.comment as string } : {},
      },
    };
  },

  parseHTML() {
    // Only claim highlights that carry a meaning; a bare <mark> pasted in from
    // elsewhere is left to whatever else wants it.
    return [
      { tag: "mark[data-intent]" },
      { tag: "mark[class*='bp-annotation-']" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setAnnotation:
        (intent, comment = null) =>
        ({ commands }) => {
          if (!isAnnotationIntentId(intent)) return false;
          return commands.setMark(this.name, { intent, comment });
        },

      toggleAnnotation:
        (intent) =>
        ({ editor, commands }) => {
          if (!isAnnotationIntentId(intent)) return false;
          if (editor.isActive(this.name, { intent })) {
            return commands.unsetMark(this.name);
          }
          // Re-marking an already-highlighted passage should change its
          // meaning, not layer a second mark on it.
          return commands.setMark(this.name, {
            intent,
            comment: editor.getAttributes(this.name).comment ?? null,
          });
        },

      unsetAnnotation:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),

      setAnnotationComment:
        (comment) =>
        ({ editor, commands }) => {
          if (!editor.isActive(this.name)) return false;
          return commands.updateAttributes(this.name, { comment: comment || null });
        },
    };
  },

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {
      "Mod-Alt-0": () => this.editor.commands.unsetAnnotation(),
    };
    for (const intent of ANNOTATION_INTENTS) {
      shortcuts[intent.shortcut] = () => this.editor.commands.toggleAnnotation(intent.id);
    }
    return shortcuts;
  },
});
