"use client";

import { cn } from "@/lib/utils";
import { AGENT_NAMES } from "@/lib/chat/prompts";

/**
 * The chat's own avatar colours.
 *
 * These used to be borrowed from the delegation roster's gradients, which
 * meant the chat imported a 17-persona cast list to pick two Tailwind
 * classes. The chat has never shown those personas — it derives its initials
 * from the context name — so the colours now live here.
 */
const CONTEXT_GRADIENTS: Record<string, { from: string; to: string }> = {
  executive: { from: "from-purple-500", to: "to-indigo-500" },
  project: { from: "from-blue-500", to: "to-purple-500" },
  note: { from: "from-teal-500", to: "to-blue-500" },
  task: { from: "from-green-500", to: "to-teal-500" },
  item: { from: "from-violet-500", to: "to-amber-500" },
  general: { from: "from-green-500", to: "to-teal-500" },
};

interface AgentAvatarProps {
  contextType: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function AgentAvatar({ contextType, size = "md", className }: AgentAvatarProps) {
  const gradient = CONTEXT_GRADIENTS[contextType] || CONTEXT_GRADIENTS.general;
  const name = AGENT_NAMES[contextType] || "Assistant";
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const sizeClasses = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-8 w-8 text-xs",
    lg: "h-10 w-10 text-sm",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white",
        gradient.from,
        gradient.to,
        sizeClasses[size],
        className
      )}
      title={name}
    >
      {initials}
    </div>
  );
}
