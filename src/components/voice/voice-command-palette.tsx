"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Mic, Check, ArrowRight, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceCommands, type VoiceCommand, type CommandCategory } from "./hooks/use-voice-commands";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface VoiceCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommandSelect?: (command: VoiceCommand) => void;
  currentTranscript?: string;
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  creation: 'Creation',
  navigation: 'Navigation',
  action: 'Actions',
  punctuation: 'Punctuation',
};

const CATEGORY_ICONS: Record<CommandCategory, React.ReactNode> = {
  creation: <Hash className="h-4 w-4" />,
  navigation: <ArrowRight className="h-4 w-4" />,
  action: <Check className="h-4 w-4" />,
  punctuation: <Mic className="h-4 w-4" />,
};

export function VoiceCommandPalette({
  open,
  onOpenChange,
  onCommandSelect,
  currentTranscript,
}: VoiceCommandPaletteProps) {
  const { commands, parseCommand } = useVoiceCommands();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CommandCategory | null>(null);
  const [matchedCommand, setMatchedCommand] = useState<VoiceCommand | null>(null);

  // Check if current transcript matches a command
  useEffect(() => {
    if (currentTranscript) {
      const match = parseCommand(currentTranscript);
      setMatchedCommand(match?.command || null);
    }
  }, [currentTranscript, parseCommand]);

  // Filter commands based on search and category
  const filteredCommands = commands.filter((cmd) => {
    const matchesSearch =
      !searchQuery ||
      cmd.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.trigger.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = !selectedCategory || cmd.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // Group commands by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = [];
    }
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<CommandCategory, VoiceCommand[]>);

  const handleCommandClick = (command: VoiceCommand) => {
    if (onCommandSelect) {
      onCommandSelect(command);
    }
  };

  const categories = Object.keys(CATEGORY_LABELS) as CommandCategory[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Voice Commands
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Search */}
          <Input
            placeholder="Search commands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />

          {/* Category filters */}
          <div className="flex gap-2 flex-wrap">
            <Badge
              variant={selectedCategory === null ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Badge>
            {categories.map((category) => (
              <Badge
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => setSelectedCategory(category)}
              >
                {CATEGORY_LABELS[category]}
              </Badge>
            ))}
          </div>

          {/* Matched command indicator */}
          {matchedCommand && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 animate-in fade-in">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <Check className="h-4 w-4" />
                <span>Command recognized: <strong>{matchedCommand.trigger[0]}</strong></span>
              </div>
            </div>
          )}

          {/* Commands list */}
          <div className="flex-1 overflow-y-auto space-y-4">
            {Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category}>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-muted-foreground">
                  {CATEGORY_ICONS[category as CommandCategory]}
                  {CATEGORY_LABELS[category as CommandCategory]}
                </h3>
                <div className="space-y-1">
                  {cmds.map((cmd, index) => (
                    <button
                      key={`${category}-${index}`}
                      onClick={() => handleCommandClick(cmd)}
                      className={cn(
                        "w-full text-left p-3 rounded-lg border transition-colors",
                        "hover:bg-accent hover:border-accent-foreground/20",
                        "focus:outline-none focus:ring-2 focus:ring-primary",
                        matchedCommand === cmd && "bg-green-500/10 border-green-500/20"
                      )}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                            {cmd.trigger[0]}
                          </code>
                          {cmd.trigger.length > 1 && (
                            <span className="text-xs text-muted-foreground">
                              +{cmd.trigger.length - 1} more
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {cmd.description}
                        </p>
                        {cmd.trigger.length > 1 && (
                          <div className="flex gap-1 flex-wrap mt-1">
                            {cmd.trigger.slice(1).map((trigger, i) => (
                              <code
                                key={i}
                                className="text-xs font-mono bg-muted/50 px-1 py-0.5 rounded"
                              >
                                {trigger}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Empty state */}
          {filteredCommands.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No commands found
                </p>
                <p className="text-xs text-muted-foreground">
                  Try a different search or category
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-xs text-muted-foreground text-center pt-4 border-t">
          Say any of these commands while recording to execute them
        </div>
      </DialogContent>
    </Dialog>
  );
}
