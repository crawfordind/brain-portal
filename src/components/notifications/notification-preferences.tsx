"use client";

/**
 * Notification Preferences - Settings panel for notification configuration
 *
 * Allows users to configure:
 * - Email notification toggles per type
 * - Digest timing (daily hour, weekly day)
 * - Quiet hours
 * - AI report preferences
 * - Due-soon thresholds
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  Mail,
  Clock,
  Brain,
  Moon,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificationPreferences } from "@/lib/db/schema";

// ─── Component ───────────────────────────────────────

export function NotificationPreferencesPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/preferences");
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json() as Promise<{ preferences: NotificationPreferences }>;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      toast.success("Preferences updated");
    },
    onError: () => {
      toast.error("Failed to update preferences");
    },
  });

  const prefs = data?.preferences;

  const deviceTimeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const timeZoneOptions = useMemo(() => {
    let zones: string[] = [];
    try {
      zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      zones = [];
    }
    const all = new Set(["UTC", deviceTimeZone, prefs?.timezone || "UTC", ...zones]);
    return [...all].sort().map((z) => ({ value: z, label: z === deviceTimeZone ? `${z} (this device)` : z }));
  }, [deviceTimeZone, prefs?.timezone]);

  // Emails compute "tomorrow", quiet hours and the digest hour in this zone.
  // Nothing ever set it, so everyone was on UTC: adopt the device's zone once,
  // while the stored value is still the untouched default.
  const adoptedTimeZone = useRef(false);
  useEffect(() => {
    if (!prefs || adoptedTimeZone.current) return;
    if (prefs.timezone && prefs.timezone !== "UTC") return;
    if (deviceTimeZone === "UTC") return;
    adoptedTimeZone.current = true;
    fetch("/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: deviceTimeZone }),
    })
      .then((res) => {
        if (res.ok) queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      })
      .catch(() => {});
  }, [prefs, deviceTimeZone, queryClient]);

  if (isLoading || !prefs) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const update = (field: string, value: unknown) => {
    updateMutation.mutate({ [field]: value });
  };

  return (
    <div className="space-y-6">
      {/* Email Master Toggle */}
      <Section
        icon={Mail}
        title="Email Notifications"
        description="Receive notifications via email"
      >
        <ToggleRow
          label="Enable email notifications"
          description="Master toggle for all email notifications"
          checked={!!prefs.email_enabled}
          onChange={(v) => update("email_enabled", v)}
        />

        {prefs.email_enabled && (
          <div className="space-y-1 mt-3 pl-1">
            <ToggleRow
              label="Reminders"
              description="When reminders are due"
              checked={!!prefs.email_reminders}
              onChange={(v) => update("email_reminders", v)}
            />
            <ToggleRow
              label="Overdue tasks"
              description="When tasks pass their due date"
              checked={!!prefs.email_overdue_tasks}
              onChange={(v) => update("email_overdue_tasks", v)}
            />
            <ToggleRow
              label="Daily digest"
              description="Daily summary with AI insights"
              checked={!!prefs.email_daily_digest}
              onChange={(v) => update("email_daily_digest", v)}
            />
            <ToggleRow
              label="Weekly report"
              description="Weekly intelligence report"
              checked={!!prefs.email_weekly_report}
              onChange={(v) => update("email_weekly_report", v)}
            />
            <ToggleRow
              label="AI agent updates"
              description="When AI tasks complete or fail"
              checked={!!prefs.email_agent_updates}
              onChange={(v) => update("email_agent_updates", v)}
            />
          </div>
        )}
      </Section>

      {/* Timing */}
      <Section
        icon={Clock}
        title="Digest Timing"
        description="When to send daily and weekly digests"
      >
        <SelectRow
          label="Timezone"
          description="Used for digest timing, quiet hours and email quick actions"
          value={prefs.timezone || "UTC"}
          options={timeZoneOptions}
          onChange={(v) => update("timezone", v)}
        />
        <SelectRow
          label="Daily digest hour"
          description={`Hour of day to send daily digest (${prefs.timezone || "UTC"})`}
          value={String(prefs.daily_digest_hour)}
          options={Array.from({ length: 24 }, (_, i) => ({
            value: String(i),
            label: `${i.toString().padStart(2, "0")}:00`,
          }))}
          onChange={(v) => update("daily_digest_hour", parseInt(v))}
        />
        <SelectRow
          label="Weekly report day"
          description="Day of week to send weekly report"
          value={String(prefs.weekly_report_day)}
          options={[
            { value: "0", label: "Sunday" },
            { value: "1", label: "Monday" },
            { value: "2", label: "Tuesday" },
            { value: "3", label: "Wednesday" },
            { value: "4", label: "Thursday" },
            { value: "5", label: "Friday" },
            { value: "6", label: "Saturday" },
          ]}
          onChange={(v) => update("weekly_report_day", parseInt(v))}
        />
      </Section>

      {/* Quiet Hours */}
      <Section
        icon={Moon}
        title="Quiet Hours"
        description="No email notifications during these hours"
      >
        <div className="flex items-center gap-3">
          <SelectRow
            label="Start"
            value={String(prefs.quiet_hours_start)}
            options={Array.from({ length: 24 }, (_, i) => ({
              value: String(i),
              label: `${i.toString().padStart(2, "0")}:00`,
            }))}
            onChange={(v) => update("quiet_hours_start", parseInt(v))}
          />
          <span className="text-muted-foreground text-sm mt-5">to</span>
          <SelectRow
            label="End"
            value={String(prefs.quiet_hours_end)}
            options={Array.from({ length: 24 }, (_, i) => ({
              value: String(i),
              label: `${i.toString().padStart(2, "0")}:00`,
            }))}
            onChange={(v) => update("quiet_hours_end", parseInt(v))}
          />
        </div>
      </Section>

      {/* AI Reports */}
      <Section
        icon={Brain}
        title="AI Reports"
        description="AI-generated digests and intelligence reports"
      >
        <ToggleRow
          label="AI daily digest"
          description="AI-generated summary of your day"
          checked={!!prefs.ai_digest_enabled}
          onChange={(v) => update("ai_digest_enabled", v)}
        />
        <ToggleRow
          label="AI weekly report"
          description="Deep AI analysis of your week with recommendations"
          checked={!!prefs.ai_weekly_enabled}
          onChange={(v) => update("ai_weekly_enabled", v)}
        />
      </Section>

      {/* Thresholds */}
      <Section
        icon={Shield}
        title="Alert Thresholds"
        description="When to flag tasks as needing attention"
      >
        <SelectRow
          label="Due soon threshold"
          description="Notify when tasks are due within this many hours"
          value={String(prefs.due_soon_hours)}
          options={[
            { value: "4", label: "4 hours" },
            { value: "8", label: "8 hours" },
            { value: "12", label: "12 hours" },
            { value: "24", label: "24 hours" },
            { value: "48", label: "48 hours" },
          ]}
          onChange={(v) => update("due_soon_hours", parseInt(v))}
        />
        <SelectRow
          label="Overdue reminder frequency"
          description="Re-notify about overdue tasks every N hours"
          value={String(prefs.overdue_reminder_hours)}
          options={[
            { value: "1", label: "Every hour" },
            { value: "2", label: "Every 2 hours" },
            { value: "4", label: "Every 4 hours" },
            { value: "8", label: "Every 8 hours" },
            { value: "24", label: "Once daily" },
          ]}
          onChange={(v) => update("overdue_reminder_hours", parseInt(v))}
        />
      </Section>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform mt-0.5",
            checked ? "translate-x-4.5 ml-0.5" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}

function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted border border-border rounded-md px-2 py-1 text-sm min-w-[120px] max-w-[55%] truncate"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
