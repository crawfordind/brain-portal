/**
 * AI Intent Classifier
 *
 * The core intelligence of the agentic workflow. Takes raw user input
 * and classifies it into the right stream item type with suggested actions.
 *
 * Uses fast_llm tier for quick classification (<500ms target).
 */

import { completeJSON } from "@/lib/ai/client";
import type { IntentClassification } from "./types";

const CLASSIFIER_SYSTEM_PROMPT = `You are the intent classifier for a personal knowledge management system called "Brain Portal". Your job is to analyze raw user input and classify it into the right category with suggested next actions.

You are incredibly perceptive - you can detect subtle cues about what the user actually wants:
- "Need to buy groceries" → task (personal, no agent needed)
- "I think our pricing should be lower" → thought (could become a note or be delegated to analyst)
- "Research best React frameworks 2026" → question (suggest delegating to research agent)
- "Write a blog post about AI workflows" → task (suggest delegating to copy agent)
- "Meeting with Sarah at 3pm tomorrow" → reminder
- "https://interesting-article.com" → reference (auto-scrape)
- "The connection between sleep and productivity is..." → note (extended thought, knowledge)
- "Should we use Postgres or SQLite?" → decision
- "Today I planted tomatoes in the garden" → journal (personal activity log)
- "Just finished installing the new shelves" → journal
- "Visited the farmers market this morning" → journal
- A long paragraph about a topic → note

Classification rules:
1. Short actionable items with verbs → task
2. URLs or quotes from others → reference
3. Time-sensitive items with dates → reminder or task with due date
4. Questions about what to do → decision
5. Questions about facts/research → question
6. Personal activity logs starting with "today I", "just finished", "visited", etc. → journal
7. Extended thoughts, reflections, knowledge → note
8. Brief observations or ideas → thought
9. Items that clearly need professional work → suggest appropriate agent

Agent suggestions:
- code: Software tasks, debugging, technical documentation, DevOps
- copy: Blog posts, emails, content creation, copywriting, creative writing
- research: Information gathering, competitive analysis, deep dives
- marketing: Ad copy, campaigns, growth strategies, SEO
- analyst: Data analysis, business insights, metrics, forecasting
- general: Brainstorming, planning, organizing
- ux: UI/UX design, user research, wireframes, accessibility
- legal: Contracts, compliance, regulations, IP, terms of service
- finance: Budgets, financial modeling, pricing, revenue analysis, P&L
- hr: Hiring, onboarding, performance reviews, job descriptions, culture
- product: Product management, roadmaps, PRDs, feature prioritization
- sales: Sales strategy, proposals, pipeline, deal negotiation, pitches
- operations: Process optimization, workflows, SOPs, automation, logistics
- security: Cybersecurity, vulnerability assessment, threat modeling, audits
- data_eng: Data pipelines, ETL, data modeling, warehouse design
- educator: Teaching, tutorials, training materials, documentation, courses
- strategy: Business strategy, competitive analysis, market positioning, OKRs

Respond with a JSON object matching the IntentClassification schema.`;

const CLASSIFIER_PROMPT = `Classify this input from the user:

<input>
{input}
</input>

{context}

Respond with JSON:
{
  "type": "thought|task|note|question|decision|reference|reminder|journal|capture",
  "confidence": 0.0-1.0,
  "title": "concise title (max 60 chars)",
  "content": "cleaned/expanded content",
  "priority": "low|medium|high|urgent",
  "dueDate": "ISO date if detected, null otherwise",
  "projectSlug": "matching project slug if detected, null otherwise",
  "tags": ["extracted", "tags"],
  "suggestedActions": [
    {"type": "delegate|expand|connect|remind|convert|archive|complete", "label": "action description", "agentType": "if delegate"}
  ],
  "suggestedAgent": "agent type if delegation is suggested, null otherwise",
  "reasoning": "one-sentence explanation of classification"
}`;

/**
 * Classify user input using AI
 */
export async function classifyIntent(
  input: string,
  context?: {
    recentItems?: Array<{ type: string; title: string }>;
    activeProjects?: Array<{ slug: string; name: string }>;
    timeOfDay?: string;
  }
): Promise<IntentClassification> {
  // Fast path: detect obvious patterns without AI
  const quickClassification = quickClassify(input);
  if (quickClassification && quickClassification.confidence >= 0.95) {
    return quickClassification;
  }

  // Build context string
  let contextStr = "";
  if (context?.activeProjects?.length) {
    contextStr += `\nActive projects: ${context.activeProjects.map(p => `${p.name} (${p.slug})`).join(", ")}`;
  }
  if (context?.recentItems?.length) {
    contextStr += `\nRecent items: ${context.recentItems.slice(0, 5).map(i => `[${i.type}] ${i.title}`).join(", ")}`;
  }
  if (context?.timeOfDay) {
    contextStr += `\nTime of day: ${context.timeOfDay}`;
  }

  const prompt = CLASSIFIER_PROMPT
    .replace("{input}", input)
    .replace("{context}", contextStr ? `<context>${contextStr}</context>` : "");

  try {
    const result = await completeJSON<IntentClassification>(prompt, {
      system: CLASSIFIER_SYSTEM_PROMPT,
      slot: "fast",
      maxTokens: 512,
    });

    // Ensure required fields have defaults
    return {
      type: result.type || "capture",
      confidence: result.confidence || 0.5,
      title: result.title || input.slice(0, 60),
      content: result.content || input,
      priority: result.priority || "medium",
      dueDate: result.dueDate || undefined,
      projectSlug: result.projectSlug || undefined,
      tags: result.tags || [],
      suggestedActions: result.suggestedActions || [],
      suggestedAgent: result.suggestedAgent || undefined,
      reasoning: result.reasoning || "Classified by AI",
    };
  } catch (error) {
    console.error("[Classifier] AI classification failed:", error);
    // Fallback to quick classification or default
    return quickClassification || {
      type: "capture",
      confidence: 0.3,
      title: input.slice(0, 60),
      content: input,
      priority: "medium",
      tags: [],
      suggestedActions: [],
      reasoning: "Fallback classification (AI unavailable)",
    };
  }
}

/**
 * Quick local classification for obvious patterns (no AI needed).
 * This is the fast path — handles clear patterns in <1ms so voice
 * captures feel instant. Ambiguous inputs fall through to AI.
 */
function quickClassify(input: string): IntentClassification | null {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // URL detection
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return {
      type: "reference",
      confidence: 0.99,
      title: "Link: " + trimmed.slice(0, 50),
      content: trimmed,
      priority: "low",
      tags: ["link"],
      suggestedActions: [
        { type: "expand", label: "Scrape & summarize" },
      ],
      reasoning: "URL detected",
    };
  }

  // URL embedded in text
  if (/https?:\/\/\S+/i.test(trimmed) && trimmed.length < 300) {
    return {
      type: "reference",
      confidence: 0.9,
      title: trimmed.replace(/https?:\/\/\S+/i, "").trim().slice(0, 60) || "Shared link",
      content: trimmed,
      priority: "low",
      tags: ["link"],
      suggestedActions: [
        { type: "expand", label: "Scrape & summarize" },
      ],
      reasoning: "URL embedded in text",
    };
  }

  // Reminder patterns: "remind me...", "at 3pm...", "tomorrow...", "don't forget..."
  const reminderPattern = /^(remind me|reminder|don'?t forget|at \d{1,2}\s*[ap]m|tomorrow\s+(morning|afternoon|evening|at)|next (week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on \w+day\s+(at|morning|afternoon))/i;
  if (reminderPattern.test(trimmed)) {
    return {
      type: "reminder",
      confidence: 0.92,
      title: trimmed.slice(0, 60),
      content: trimmed,
      priority: "medium",
      tags: ["reminder"],
      suggestedActions: [
        { type: "remind", label: "Set reminder" },
      ],
      reasoning: "Reminder pattern detected",
    };
  }

  // Question patterns: starts with question words or ends with ?
  const questionPattern = /^(what|how|why|when|where|who|which|can|could|should|would|is|are|does|do|will|was|were)\b/i;
  if (questionPattern.test(trimmed) || trimmed.endsWith("?")) {
    // Decision question: "should we", "should I", comparative questions
    const decisionPattern = /\b(should (we|i)|or\b|versus|vs\.?|better|prefer|choose|pick|decide|option)/i;
    if (decisionPattern.test(trimmed)) {
      return {
        type: "decision",
        confidence: 0.85,
        title: trimmed.slice(0, 60),
        content: trimmed,
        priority: "medium",
        tags: [],
        suggestedActions: [
          { type: "delegate", label: "Get AI analysis", agentType: "analyst" },
          { type: "expand", label: "Create pros/cons" },
        ],
        reasoning: "Decision question detected",
      };
    }

    // Research question: "what is", "how does", factual queries
    const researchPattern = /^(what is|what are|how does|how do|how to|explain|tell me about|research|look up|look into|find out)/i;
    if (researchPattern.test(trimmed)) {
      return {
        type: "question",
        confidence: 0.88,
        title: trimmed.slice(0, 60),
        content: trimmed,
        priority: "medium",
        tags: [],
        suggestedActions: [
          { type: "delegate", label: "Research this", agentType: "research" },
        ],
        reasoning: "Research question detected",
      };
    }

    // General question
    return {
      type: "question",
      confidence: 0.8,
      title: trimmed.slice(0, 60),
      content: trimmed,
      priority: "medium",
      tags: [],
      suggestedActions: [
        { type: "delegate", label: "Research this", agentType: "research" },
      ],
      reasoning: "Question detected",
    };
  }

  // Content creation patterns → task with agent suggestion
  const contentCreationPattern = /^(write|draft|compose|create|generate|make)\s+(a |an |the |me )?(blog|post|article|email|newsletter|copy|tweet|thread|script|proposal|report|presentation|pitch|brief|outline|summary)/i;
  if (contentCreationPattern.test(trimmed)) {
    return {
      type: "task",
      confidence: 0.9,
      title: trimmed.slice(0, 60),
      content: trimmed,
      priority: "medium",
      tags: ["content"],
      suggestedActions: [
        { type: "delegate", label: "Delegate to Writer", agentType: "copy" },
      ],
      suggestedAgent: "copy",
      reasoning: "Content creation task — suggesting Writer agent",
    };
  }

  // Code/dev patterns → task with dev agent suggestion
  const devPattern = /^(build|code|implement|debug|fix\s+the\s+bug|deploy|refactor|set up|configure|install|migrate|create\s+(a |an |the )?(api|component|page|endpoint|function|database|schema|test|module))/i;
  if (devPattern.test(trimmed)) {
    return {
      type: "task",
      confidence: 0.9,
      title: trimmed.slice(0, 60),
      content: trimmed,
      priority: "medium",
      tags: ["dev"],
      suggestedActions: [
        { type: "delegate", label: "Delegate to Dev", agentType: "code" },
      ],
      suggestedAgent: "code",
      reasoning: "Development task — suggesting Dev agent",
    };
  }

  // Research/analysis patterns → task with research/analyst agent suggestion
  const researchPattern = /^(research|analyze|investigate|compare|evaluate|audit|assess|benchmark|review\s+(the\s+)?(data|metrics|numbers|analytics|performance|market|competitor))/i;
  if (researchPattern.test(trimmed)) {
    return {
      type: "task",
      confidence: 0.88,
      title: trimmed.slice(0, 60),
      content: trimmed,
      priority: "medium",
      tags: ["research"],
      suggestedActions: [
        { type: "delegate", label: "Delegate to Researcher", agentType: "research" },
      ],
      suggestedAgent: "research",
      reasoning: "Research/analysis task — suggesting Research agent",
    };
  }

  // Marketing patterns → task with marketing agent suggestion
  const marketingPattern = /^(create|write|draft|plan|design)\s+(a |an |the |me )?(campaign|ad|advertisement|marketing|landing page|funnel|growth|conversion|seo|social media|content strategy)/i;
  if (marketingPattern.test(trimmed)) {
    return {
      type: "task",
      confidence: 0.88,
      title: trimmed.slice(0, 60),
      content: trimmed,
      priority: "medium",
      tags: ["marketing"],
      suggestedActions: [
        { type: "delegate", label: "Delegate to Marketer", agentType: "marketing" },
      ],
      suggestedAgent: "marketing",
      reasoning: "Marketing task — suggesting Marketer agent",
    };
  }

  // General task patterns: starts with verb or "need to", "should", "I have to", etc.
  const taskPattern = /^(need to|have to|gotta|should|must|todo|task:|fix|build|create|write|send|call|buy|get|find|check|update|review|schedule|plan|prepare|finish|complete|set up|implement|deploy|configure|install|remove|delete|clean|organize|arrange|book|order|pay|submit|apply|register|sign up|cancel|return|pick up|drop off|move|ship|upload|download|print|scan|file|sort|pack|test|push|pull|merge|release|launch|start|stop|close|open|turn|run|make|add|change|edit|modify|rename|replace|assign|approve|reject|prioritize|escalate|follow up|reach out|contact|respond|reply|confirm|verify|validate|track|monitor|measure|report|document)/i;
  if (taskPattern.test(trimmed) && trimmed.length < 200) {
    return {
      type: "task",
      confidence: 0.85,
      title: trimmed.replace(/^(need to|have to|gotta|should|must|todo:|task:)\s*/i, "").slice(0, 60),
      content: trimmed,
      priority: detectPriority(lower),
      tags: [],
      suggestedActions: [
        { type: "complete", label: "Mark done" },
        { type: "delegate", label: "Delegate to AI", agentType: "general" },
      ],
      reasoning: "Task pattern detected",
    };
  }

  // "I need to" / "I want to" / "I should" / "We need to" — common voice patterns
  const personalTaskPattern = /^(i |we )(need to|want to|should|have to|gotta|must)\b/i;
  if (personalTaskPattern.test(trimmed) && trimmed.length < 200) {
    const cleanTitle = trimmed.replace(/^(i |we )(need to|want to|should|have to|gotta|must)\s*/i, "");
    return {
      type: "task",
      confidence: 0.82,
      title: (cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1)).slice(0, 60),
      content: trimmed,
      priority: detectPriority(lower),
      tags: [],
      suggestedActions: [
        { type: "complete", label: "Mark done" },
        { type: "delegate", label: "Delegate to AI", agentType: "general" },
      ],
      reasoning: "Personal task pattern detected from voice",
    };
  }

  // Quote patterns: starts with a quote mark or "quote:"
  if (/^["'\u201C\u201D]/.test(trimmed) || /^quote:/i.test(trimmed)) {
    return {
      type: "reference",
      confidence: 0.85,
      title: trimmed.replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, "").slice(0, 60),
      content: trimmed,
      priority: "low",
      tags: ["quote"],
      suggestedActions: [
        { type: "connect", label: "Find related notes" },
      ],
      reasoning: "Quote detected",
    };
  }

  // Idea patterns: "what if", "idea:", "I think we could", "how about"
  const ideaPattern = /^(what if|idea:|i think we could|how about|imagine|wouldn'?t it be|we could|maybe we should|concept:|brainstorm)/i;
  if (ideaPattern.test(trimmed)) {
    return {
      type: "thought",
      confidence: 0.85,
      title: trimmed.replace(/^(idea:|concept:|brainstorm:?)\s*/i, "").slice(0, 60),
      content: trimmed,
      priority: "medium",
      tags: ["idea"],
      suggestedActions: [
        { type: "expand", label: "Expand into a note" },
        { type: "delegate", label: "Brainstorm with AI", agentType: "general" },
      ],
      reasoning: "Idea/brainstorm detected",
    };
  }

  // Journal patterns: "today I", "this morning I", "journal:", "just finished", diary-style entries
  const journalPattern = /^(today i|this morning i|this afternoon i|this evening i|tonight i|yesterday i|just (finished|completed|got back|came back|went|visited|bought|installed|planted|cooked|made|had)|journal:|diary:|log:)/i;
  if (journalPattern.test(trimmed)) {
    const cleanTitle = trimmed
      .replace(/^(journal:|diary:|log:)\s*/i, "")
      .slice(0, 60);
    return {
      type: "journal" as any,
      confidence: 0.92,
      title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
      content: trimmed,
      priority: "low",
      tags: [],
      suggestedActions: [
        { type: "expand", label: "Add to journal" },
      ],
      reasoning: "Journal entry detected — personal activity log",
    };
  }

  // "start a journal" / "new journal entry" / "journal post" patterns
  const startJournalPattern = /^(start|begin|new|open|create)\s+(a\s+)?(journal|diary)\s*(entry|post|note)?/i;
  if (startJournalPattern.test(trimmed)) {
    return {
      type: "journal" as any,
      confidence: 0.95,
      title: "Journal Entry",
      content: trimmed,
      priority: "low",
      tags: [],
      suggestedActions: [
        { type: "expand", label: "Open journal" },
      ],
      reasoning: "Journal creation request detected",
    };
  }

  // Note-worthy patterns: "note:", "note to self", "remember that", knowledge statements
  const notePattern = /^(note:|note to self|remember that|the key (thing|point|insight) is|i learned|important:|takeaway:|insight:)/i;
  if (notePattern.test(trimmed)) {
    return {
      type: "note",
      confidence: 0.88,
      title: trimmed.replace(/^(note:|note to self:?|important:|takeaway:|insight:)\s*/i, "").slice(0, 60),
      content: trimmed,
      priority: "low",
      tags: [],
      suggestedActions: [
        { type: "connect", label: "Find connections" },
        { type: "expand", label: "Expand" },
      ],
      reasoning: "Note pattern detected",
    };
  }

  // Long input (> 200 chars) → likely a note
  if (trimmed.length > 200) {
    return {
      type: "note",
      confidence: 0.8,
      title: trimmed.split(/[.\n]/)[0]?.slice(0, 60) || trimmed.slice(0, 60),
      content: trimmed,
      priority: "low",
      tags: [],
      suggestedActions: [
        { type: "connect", label: "Find connections" },
        { type: "delegate", label: "Get AI analysis", agentType: "analyst" },
      ],
      reasoning: "Extended text input",
    };
  }

  // Very short input (< 20 chars) with no verb → likely a thought
  if (trimmed.length < 20 && !/\b(need|should|must|will|do|make|write|build|fix|create|send|call|buy|get|find|check|remind|schedule|plan|book|cancel)\b/i.test(trimmed)) {
    return {
      type: "thought",
      confidence: 0.7,
      title: trimmed,
      content: trimmed,
      priority: "low",
      tags: [],
      suggestedActions: [
        { type: "expand", label: "Expand into a note" },
      ],
      reasoning: "Short non-actionable input",
    };
  }

  return null; // Let AI handle ambiguous cases
}

/**
 * Detect priority from text keywords
 */
function detectPriority(lower: string): "low" | "medium" | "high" | "urgent" {
  if (/\b(urgent|asap|critical|immediately|right now|emergency)\b/.test(lower)) return "urgent";
  if (/\b(important|high priority|high pri|prioritize)\b/.test(lower)) return "high";
  if (/\b(low priority|no rush|whenever|low pri|not urgent)\b/.test(lower)) return "low";
  return "medium";
}

/**
 * Batch classify multiple inputs (for import/migration)
 */
export async function batchClassify(
  inputs: string[],
  context?: Parameters<typeof classifyIntent>[1]
): Promise<IntentClassification[]> {
  return Promise.all(inputs.map(input => classifyIntent(input, context)));
}
