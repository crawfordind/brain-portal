"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { themes } from "@/lib/themes";
import { useStreamDensity } from "@/hooks/use-stream-density";
import { DENSITY_LABELS, STREAM_DENSITIES } from "@/lib/stream/density";
import { SettingsGroup } from "../settings-primitives";

const noopSubscribe = () => () => {};

function ThemePreview({ bg, surface, text, accent }: { bg: string; surface: string; text: string; accent: string }) {
  return (
    <div className="flex h-16 overflow-hidden rounded-lg shadow-sm" style={{ background: bg }}>
      <div className="h-full w-8 shrink-0" style={{ background: surface }} />
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-2">
        <div className="h-1.5 w-[70%] rounded-full" style={{ background: text, opacity: 0.5 }} />
        <div className="h-1.5 w-[45%] rounded-full" style={{ background: text, opacity: 0.3 }} />
        <div className="mt-1 h-2.5 w-[40%] rounded" style={{ background: accent }} />
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [density, setDensity] = useStreamDensity();
  // next-themes only knows the stored choice in the browser; on the server
  // nothing is selected rather than the wrong thing.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const selected = mounted ? theme : undefined;

  const options = [
    ...themes.map((t) => ({
      id: t.id,
      label: t.label,
      hint: t.description,
      preview: <ThemePreview {...t.preview} />,
    })),
    {
      id: "system",
      label: "System",
      hint: "Follows your device",
      preview: (
        <div className="flex h-16 overflow-hidden rounded-lg shadow-sm">
          <div className="h-full w-1/2 bg-white" />
          <div className="h-full w-1/2 bg-[#1c1c1e]" />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SettingsGroup title="Theme" description="Choose a look, or follow your device's light and dark setting.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 p-3 sm:gap-3">
          {options.map((option) => {
            const active = selected === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(option.id)}
                className={cn(
                  "relative rounded-xl border-2 p-2 text-left transition-colors sm:p-2.5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary" : "border-transparent hover:border-border"
                )}
              >
                {option.preview}
                <span className="mt-2 block text-xs font-semibold">{option.label}</span>
                <span className="hidden text-[11px] leading-tight text-muted-foreground sm:block">
                  {option.hint}
                </span>
                {active && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Stream density"
        description="How much each row on the home stream shows. Remembered per device, so a phone and a desktop can differ."
      >
        <div role="radiogroup" aria-label="Stream density">
          {STREAM_DENSITIES.map((option, index) => {
            const active = mounted && density === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDensity(option)}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  index > 0 && "border-t",
                  index === 0 && "rounded-t-xl",
                  index === STREAM_DENSITIES.length - 1 && "rounded-b-xl"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-primary" : "border-muted-foreground/40"
                  )}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{DENSITY_LABELS[option].label}</span>
                  <span className="block text-xs text-muted-foreground">{DENSITY_LABELS[option].hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>
    </div>
  );
}
