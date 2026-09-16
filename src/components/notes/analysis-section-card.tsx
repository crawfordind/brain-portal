// src/components/notes/analysis-section-card.tsx
"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  ArrowUpRight,
  Search,
  CircleDot,
  Lightbulb,
  HelpCircle,
  ListChecks,
  BookOpen,
  Link as LinkIcon,
  User,
  Building2,
  MapPin,
  Cpu,
  Calendar,
  Hash,
  TrendingUp,
} from "lucide-react";
import type {
  ExtractedLink,
  ExtractedEntity,
  KeyFinding,
  ResearchThread,
  ActionItem,
  OpenQuestion,
} from "@/lib/analysis/types";

// === Entity Icon Helper ===
function EntityIcon({ type }: { type: ExtractedEntity["type"] }) {
  const iconMap = {
    person: User,
    organization: Building2,
    place: MapPin,
    concept: Lightbulb,
    technology: Cpu,
    date: Calendar,
    metric: TrendingUp,
  };
  const Icon = iconMap[type] || Hash;
  return <Icon className="h-3 w-3" />;
}

// === Importance / Priority Badge ===
function ImportanceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
    medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    low: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
  };
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${styles[level]}`}>
      {level}
    </Badge>
  );
}

// === Copy Button ===
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

// === Executive Summary Card ===
export function ExecutiveSummaryCard({ summary }: { summary: string }) {
  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <BookOpen className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold mb-2">Executive Summary</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// === Key Findings Card ===
export function KeyFindingsCard({ findings }: { findings: KeyFinding[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (findings.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Lightbulb className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-sm font-semibold">Key Findings</h3>
          <Badge variant="secondary" className="text-[10px] ml-auto">{findings.length}</Badge>
        </div>
        <div className="space-y-2">
          {findings.map((f) => (
            <div
              key={f.id}
              className="group/item rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => setExpanded(expanded === f.id ? null : f.id)}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5">
                  {expanded === f.id ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <ImportanceBadge level={f.importance} />
                  </div>
                  <p className="text-sm">{f.insight}</p>
                  {expanded === f.id && f.evidence && (
                    <blockquote className="mt-2 pl-3 border-l-2 border-muted-foreground/30 text-xs text-muted-foreground italic">
                      {f.evidence}
                    </blockquote>
                  )}
                </div>
                <CopyButton text={f.insight} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// === Research Threads Card ===
export function ResearchThreadsCard({ threads }: { threads: ResearchThread[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (threads.length === 0) return null;

  const depthColor = {
    surface: "bg-green-500/10 text-green-700 dark:text-green-400",
    moderate: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    deep: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Search className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
          </div>
          <h3 className="text-sm font-semibold">Research Threads</h3>
          <Badge variant="secondary" className="text-[10px] ml-auto">{threads.length}</Badge>
        </div>
        <div className="space-y-2">
          {threads.map((t) => (
            <div
              key={t.id}
              className="group/item rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => setExpanded(expanded === t.id ? null : t.id)}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5">
                  {expanded === t.id ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{t.topic}</span>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${depthColor[t.depth]}`}>
                      {t.depth}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.summary}</p>

                  {expanded === t.id && (
                    <div className="mt-3 space-y-2">
                      {t.relatedConcepts.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {t.relatedConcepts.map((c) => (
                            <Badge key={c} variant="outline" className="text-[10px]">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {t.suggestedQueries.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Suggested searches
                          </span>
                          {t.suggestedQueries.map((q, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs text-muted-foreground group/query"
                            >
                              <ArrowUpRight className="h-3 w-3 shrink-0" />
                              <span className="truncate">{q}</span>
                              <CopyButton text={q} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// === Action Items Card ===
export function ActionItemsCard({ items }: { items: ActionItem[] }) {
  if (items.length === 0) return null;

  const categoryIcon = {
    follow_up: CircleDot,
    research: Search,
    create: BookOpen,
    review: Lightbulb,
    decide: HelpCircle,
    communicate: User,
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-green-500/10 flex items-center justify-center">
            <ListChecks className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-sm font-semibold">Action Items</h3>
          <Badge variant="secondary" className="text-[10px] ml-auto">{items.length}</Badge>
        </div>
        <div className="space-y-2">
          {items.map((item) => {
            const CatIcon = categoryIcon[item.category] || CircleDot;
            return (
              <div key={item.id} className="group/item flex items-start gap-3 rounded-lg border p-3">
                <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <CatIcon className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <ImportanceBadge level={item.priority} />
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {item.category.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="text-sm">{item.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">{item.reasoning}</p>
                </div>
                <CopyButton text={item.action} />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// === Open Questions Card ===
export function OpenQuestionsCard({ questions }: { questions: OpenQuestion[] }) {
  if (questions.length === 0) return null;

  const typeStyle = {
    clarification: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    exploration: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    decision: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    validation: "bg-green-500/10 text-green-700 dark:text-green-400",
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <HelpCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-sm font-semibold">Open Questions</h3>
          <Badge variant="secondary" className="text-[10px] ml-auto">{questions.length}</Badge>
        </div>
        <div className="space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="group/item rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 mb-1 ${typeStyle[q.type]}`}>
                    {q.type}
                  </Badge>
                  <p className="text-sm font-medium">{q.question}</p>
                  <p className="text-xs text-muted-foreground mt-1">{q.context}</p>
                </div>
                <CopyButton text={q.question} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// === Extracted Links Card ===
export function LinksCard({ links }: { links: ExtractedLink[] }) {
  if (links.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-sky-500/10 flex items-center justify-center">
            <LinkIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
          </div>
          <h3 className="text-sm font-semibold">Links & References</h3>
          <Badge variant="secondary" className="text-[10px] ml-auto">{links.length}</Badge>
        </div>
        <div className="space-y-1.5">
          {links.map((link, i) => (
            <div key={i} className="group/item flex items-center gap-2 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors">
              <div className="h-5 w-5 rounded bg-muted flex items-center justify-center shrink-0">
                {link.type === 'external' ? (
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <LinkIcon className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{link.title || link.url}</p>
                <p className="text-[10px] text-muted-foreground truncate">{link.url}</p>
              </div>
              <CopyButton text={link.url} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// === Entities Card ===
export function EntitiesCard({ entities }: { entities: ExtractedEntity[] }) {
  if (entities.length === 0) return null;

  const typeColor: Record<string, string> = {
    person: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    organization: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    place: "bg-green-500/10 text-green-700 dark:text-green-400",
    concept: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    technology: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
    date: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    metric: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Hash className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-sm font-semibold">Entities & Mentions</h3>
          <Badge variant="secondary" className="text-[10px] ml-auto">{entities.length}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {entities.map((entity, i) => (
            <div
              key={i}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${typeColor[entity.type] || "bg-muted text-muted-foreground"}`}
              title={entity.context}
            >
              <EntityIcon type={entity.type} />
              <span className="font-medium">{entity.name}</span>
              {entity.mentions > 1 && (
                <span className="opacity-60">&times;{entity.mentions}</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// === Related Notes Card ===
export function RelatedNotesCard({
  notes,
}: {
  notes: Array<{ id: string; title: string; similarity: number }>;
}) {
  if (notes.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <BookOpen className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
          </div>
          <h3 className="text-sm font-semibold">Related Notes</h3>
          <Badge variant="secondary" className="text-[10px] ml-auto">{notes.length}</Badge>
        </div>
        <div className="space-y-1.5">
          {notes.map((note) => (
            <div
              key={note.id}
              className="flex items-center gap-2 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{note.title}</p>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {Math.round(note.similarity * 100)}% match
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
