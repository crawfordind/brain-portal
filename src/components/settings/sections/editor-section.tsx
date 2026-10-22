"use client";

import { useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { useEditorSpellcheck } from "@/hooks/use-editor-spellcheck";
import { ANNOTATION_INTENTS } from "@/lib/annotations/intents";
import { SettingsGroup, SettingsRow } from "../settings-primitives";

const noopSubscribe = () => () => {};
const getIsMac = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const getServerIsMac = () => false;

/** "Mod-Alt-1" as the keys on this keyboard: "⌘⌥1" or "Ctrl+Alt+1". */
function formatShortcut(shortcut: string, mac: boolean): string {
  const keys = shortcut.split("-").map((key) => {
    if (key === "Mod") return mac ? "⌘" : "Ctrl";
    if (key === "Alt") return mac ? "⌥" : "Alt";
    if (key === "Shift") return mac ? "⇧" : "Shift";
    return key;
  });
  return keys.join(mac ? "" : "+");
}

export function EditorSection() {
  const [spellcheck, setSpellcheck] = useEditorSpellcheck();
  const mac = useSyncExternalStore(noopSubscribe, getIsMac, getServerIsMac);

  return (
    <div className="space-y-6">
      <SettingsGroup title="Writing">
        <SettingsRow
          label="Spell check"
          description="Underline misspelled words while you write. Uses this device's dictionary."
          htmlFor="settings-spellcheck"
        >
          <Switch
            id="settings-spellcheck"
            checked={spellcheck}
            onCheckedChange={setSpellcheck}
          />
        </SettingsRow>
        <SettingsRow
          label="Saving"
          description="Notes save on their own as you type. There is nothing to press."
        />
      </SettingsGroup>

      <SettingsGroup
        title="Highlight colours"
        description="A highlight tells the AI what to do with a passage. Select text, then pick a colour."
      >
        {ANNOTATION_INTENTS.map((intent) => (
          <SettingsRow
            key={intent.id}
            label={
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: intent.swatch }}
                />
                {intent.label}
              </span>
            }
            description={intent.meaning}
          >
            {/* A keyboard shortcut means nothing on a phone. */}
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline-block">
              {formatShortcut(intent.shortcut, mac)}
            </kbd>
          </SettingsRow>
        ))}
      </SettingsGroup>
    </div>
  );
}
