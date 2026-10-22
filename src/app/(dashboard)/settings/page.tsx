import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SettingsShell } from "@/components/settings/settings-shell";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  return (
    <SettingsShell
      account={{
        email: user.email,
        displayName: user.display_name,
        createdAt: user.created_at ?? null,
      }}
    />
  );
}
