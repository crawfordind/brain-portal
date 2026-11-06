/**
 * Filling a template's variables. Pure: the caller supplies "now", the zone
 * and the project, so a test can pin all three and the browser can use the
 * viewer's own zone (the server runs in UTC, which would date an evening
 * meeting tomorrow).
 *
 * Unknown `{{tokens}}` are left exactly as written, so a template that talks
 * about `{{handlebars}}` is not mangled.
 */

export interface TemplateContext {
  now: Date;
  /** IANA zone, e.g. "America/New_York". Falls back to UTC if unknown. */
  timeZone?: string;
  projectName?: string | null;
  /** BCP 47 locale for words (weekday, month). Default "en-US". */
  locale?: string;
}

interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number;
}

function safeZone(zone: string | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** The calendar day and clock time at `now` in `zone`. */
function zonedParts(now: Date, zone: string): CalendarDay & { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** Calendar arithmetic on a day, done in UTC so no zone can shift it. */
function addDays(day: CalendarDay, days: number): CalendarDay {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function iso(day: CalendarDay): string {
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

/** Noon UTC on that day: formatting it in UTC can never roll to a neighbour. */
function asUtcNoon(day: CalendarDay): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, 12));
}

/** ISO-8601 week number. */
export function isoWeek(day: CalendarDay): number {
  const d = asUtcNoon(day);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  const firstDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDow + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

const TOKEN = /\{\{\s*([a-z_]+)\s*(?:([+-])\s*(\d{1,4}))?\s*\}\}/gi;

export interface RenderOptions {
  /** Escape substituted values for HTML (template bodies are usually HTML). */
  html?: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

/** Replace every known `{{variable}}` in `text`. */
export function renderTemplate(text: string, ctx: TemplateContext, options: RenderOptions = {}): string {
  if (!text) return "";
  const zone = safeZone(ctx.timeZone);
  const locale = ctx.locale || "en-US";
  const now = zonedParts(ctx.now, zone);
  const today: CalendarDay = { year: now.year, month: now.month, day: now.day };

  return text.replace(TOKEN, (whole, rawName: string, sign?: string, amount?: string) => {
    const name = rawName.toLowerCase();
    const offset = sign && amount ? (sign === "-" ? -1 : 1) * Number(amount) : 0;
    const day = offset ? addDays(today, offset) : today;
    const dayDate = asUtcNoon(day);
    let value: string | null;
    switch (name) {
      case "date":
        value = iso(day);
        break;
      case "date_long":
        value = new Intl.DateTimeFormat(locale, {
          timeZone: "UTC",
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(dayDate);
        break;
      case "weekday":
        value = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }).format(dayDate);
        break;
      case "month":
        value = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long" }).format(dayDate);
        break;
      case "year":
        value = String(day.year);
        break;
      case "week":
        value = String(isoWeek(day));
        break;
      case "time":
        value = offset ? null : `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;
        break;
      case "project":
        value = offset ? null : (ctx.projectName ?? "").trim();
        break;
      default:
        value = null;
    }
    if (value === null) return whole;
    return options.html ? escapeHtml(value) : value;
  });
}

/** True when the text uses at least one variable this module fills. */
export function hasTemplateVariables(text: string): boolean {
  TOKEN.lastIndex = 0;
  return /\{\{\s*(date|date_long|weekday|time|week|month|year|project)\s*(?:[+-]\s*\d{1,4})?\s*\}\}/i.test(text);
}
