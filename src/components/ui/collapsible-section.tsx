"use client";

import { useState, useEffect, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as Collapsible from "@radix-ui/react-collapsible";

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  count?: number;
  defaultExpanded?: boolean;
  projectId?: string;
  sectionKey?: string;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  icon,
  count,
  defaultExpanded = true,
  projectId,
  sectionKey,
  children,
  className = "",
}: CollapsibleSectionProps) {
  const storageKey = projectId && sectionKey ? `project_${projectId}_section_${sectionKey}` : null;

  const [isExpanded, setIsExpanded] = useState(() => {
    if (!storageKey) return defaultExpanded;
    const stored = localStorage.getItem(storageKey);
    return stored !== null ? stored === 'true' : defaultExpanded;
  });

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(isExpanded));
    }
  }, [isExpanded, storageKey]);

  return (
    <Card className={className}>
      <Collapsible.Root open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="p-4">
          <Collapsible.Trigger asChild>
            <button
              className="flex items-center justify-between w-full text-left hover:opacity-80 transition-opacity"
              aria-label={`Toggle ${title} section`}
            >
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                {icon}
                {title}
                {count !== undefined && (
                  <Badge variant="secondary" className="ml-2">
                    {count}
                  </Badge>
                )}
              </CardTitle>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  isExpanded ? "" : "-rotate-90"
                }`}
                aria-hidden="true"
              />
            </button>
          </Collapsible.Trigger>
        </CardHeader>

        <Collapsible.Content>
          <CardContent className="p-4 pt-0">{children}</CardContent>
        </Collapsible.Content>
      </Collapsible.Root>
    </Card>
  );
}
