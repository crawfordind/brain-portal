"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsGroup, SettingsRow } from "../settings-primitives";

export interface SettingsAccount {
  email: string;
  displayName: string | null;
  /** ISO timestamp, or SQLite's `YYYY-MM-DD HH:MM:SS` (UTC). */
  createdAt: string | null;
}

function formatMemberSince(raw: string | null): string | null {
  if (!raw) return null;
  // SQLite's datetime('now') has no zone marker and is UTC by definition.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

export function AccountSection({ account }: { account: SettingsAccount }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const name = account.displayName?.trim() || account.email.split("@")[0];
  const memberSince = formatMemberSince(account.createdAt);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/auth/login");
      toast.success("Signed out");
    } catch {
      toast.error("Couldn't sign out. Try again.");
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-xl border bg-card p-4">
        <div
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl font-semibold uppercase text-primary"
        >
          {name.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">{account.email}</p>
          {memberSince && (
            <p className="text-xs text-muted-foreground">Member since {memberSince}</p>
          )}
        </div>
      </div>

      <SettingsGroup title="Sign-in">
        <SettingsRow label="Email address" description="Sign-in links and codes are sent here">
          <span className="max-w-[12rem] truncate text-sm text-muted-foreground sm:max-w-xs">
            {account.email}
          </span>
        </SettingsRow>
        <SettingsRow
          label="Sign-in method"
          description="No password. Each sign-in uses a one-time link or six-digit code."
        />
      </SettingsGroup>

      <SettingsGroup title="This device">
        <SettingsRow
          label="Sign out"
          description="End your session in this browser. Other devices stay signed in."
          stackOnMobile
        >
          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={signingOut}
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
