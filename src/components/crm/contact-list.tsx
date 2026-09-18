"use client";

/**
 * The Rolodex list: one contact per row, sectioned by letter.
 *
 * The shape is the Android Contacts shape, for the reason Android uses it — a
 * list you read by scrolling has to put the name where the eye already is, and
 * everything else has to earn its pixels. Each row is an avatar, a name, one
 * supporting line and a short trailing measure of how alive the relationship
 * is. What used to be three wrapping rows of badges is now roughly 56px.
 *
 * Density follows the same rule as the stream (see CLAUDE.md, "Reading the
 * stream"): rows get shorter by **removing** elements, never by shrinking type
 * below 12px or a touch target below 44px. The row is its own 56px target, type
 * bottoms out at `text-xs`, and anything that will not fit a narrow screen is
 * dropped outright rather than squeezed.
 *
 * The one thing density may not do is hide a decision. Unresolved, possible
 * duplicate and a non-public compartment are all "a human has to look at this",
 * so they survive as a cluster of icon chips beside the name — spelled out in
 * the accessible name at every width, and in visible text once there is room.
 *
 * Rows are a ruled list rather than a stack of cards, like the stream feed, and
 * the list has no `overflow-hidden` wrapper: that would make the section
 * headings sticky to a box that never scrolls, which is to say not sticky.
 */

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  AtSign,
  HelpCircle,
  Link2,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
} from "lucide-react";
import { ContactAvatar } from "@/components/crm/contact-avatar";
import { ROLE_LABELS } from "@/components/crm/crm-badges";
import {
  contactStatuses,
  entityTypeLabel,
  groupContactsByLetter,
  lastTouchLabel,
  primaryChannelFor,
  type ContactStatus,
  type ContactStatusKind,
} from "@/lib/crm/contact-list";
import { cn } from "@/lib/utils";

/** The shape `/api/crm/contacts` returns, as far as a row cares. */
export interface ContactListRow {
  entity: {
    id: string;
    canonical_name: string;
    entity_type: string;
    mention_count: number;
    last_seen_at: string;
  };
  compartments: string[];
  resolution: "confirmed" | "unresolved";
  needsReview: boolean;
  channels: { kind: string; value: string; is_primary: number }[];
  roles: { ventureId: string; ventureName: string; edgeType: string }[];
  lastInteractionAt: string | null;
}

const CHANNEL_ICONS: Record<string, typeof Mail | undefined> = {
  email: Mail,
  phone: Phone,
  handle: AtSign,
  url: Link2,
  address: MapPin,
};

const STATUS_ICONS: Record<ContactStatusKind, typeof AlertTriangle> = {
  unresolved: HelpCircle,
  duplicate: AlertTriangle,
  restricted: Lock,
};

/**
 * Status colours match the badges these chips replace, so a user who learned
 * "orange triangle = duplicate" on the contact page does not have to learn it
 * again here. The icon, not the hue, is what carries the meaning.
 */
const STATUS_CLASSES: Record<ContactStatusKind, string> = {
  unresolved: "border-dashed border-border text-muted-foreground",
  duplicate: "border-orange-500/50 text-orange-700 dark:text-orange-400",
  restricted: "border-amber-500/40 text-amber-700 dark:text-amber-400",
};

export function ContactList({ contacts }: { contacts: ContactListRow[] }) {
  // One clock for the whole render pass, so two contacts touched a second apart
  // cannot land on opposite sides of a day boundary.
  const now = new Date();
  const sections = groupContactsByLetter(
    contacts,
    (contact) => contact.entity.canonical_name
  );

  return (
    // Pulled out to the page container's padding, so a row's hover state reads
    // as a full-width band rather than a floating card.
    <div className="-mx-3">
      {sections.map((section) => (
        <section key={section.letter}>
          {/* Sticky within `main`, the page's scroll container: the heading
              answers "where am I in the alphabet?" for whatever row is under
              it, which is the whole point of sectioning. */}
          <h2
            id={`crm-section-${section.letter}`}
            className="sticky top-0 z-10 bg-background/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur"
          >
            {section.letter}
          </h2>
          <ul
            aria-labelledby={`crm-section-${section.letter}`}
            className="divide-y border-y"
          >
            {section.contacts.map((contact) => (
              <ContactRow key={contact.entity.id} contact={contact} now={now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface Segment {
  key: string;
  node: ReactNode;
  /** Segments that only appear once there is width to spend on them. */
  wideOnly?: boolean;
}

function ContactRow({ contact, now }: { contact: ContactListRow; now: Date }) {
  const { entity } = contact;
  const statuses = contactStatuses(contact);
  const role = contact.roles.at(0);
  const extraRoles = contact.roles.length - 1;
  const touch = lastTouchLabel(contact.lastInteractionAt, now);

  const primaryChannel = primaryChannelFor(contact.channels);
  const secondChannel =
    contact.channels.find((channel) => channel !== primaryChannel) ?? null;

  const segments: Segment[] = [];
  if (role) {
    segments.push({
      key: "role",
      node: (
        <span className="truncate">
          {ROLE_LABELS[role.edgeType] ?? role.edgeType} · {role.ventureName}
          {extraRoles > 0 && ` +${extraRoles}`}
        </span>
      ),
    });
  }
  if (primaryChannel) {
    segments.push({ key: "channel", node: <Channel channel={primaryChannel} /> });
  }
  if (secondChannel) {
    segments.push({
      key: "channel-2",
      node: <Channel channel={secondChannel} />,
      wideOnly: true,
    });
  }
  // A row with neither a role nor a way to reach the contact still needs a
  // second line, or it reads as a broken record rather than a thin one.
  if (segments.length === 0) {
    segments.push({
      key: "mentions",
      node: (
        <span className="truncate">
          {entity.mention_count === 1
            ? "1 mention"
            : `${entity.mention_count} mentions`}
        </span>
      ),
    });
  }

  return (
    <li>
      <Link
        href={`/crm/${entity.id}`}
        className="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ContactAvatar
          seed={entity.id}
          name={entity.canonical_name}
          entityType={entity.entity_type}
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {entity.canonical_name}
            </span>
            {/* Person vs organisation is a shape on screen; a screen reader
                gets it as a word. */}
            <span className="sr-only">
              , {entityTypeLabel(entity.entity_type)}
            </span>
            {statuses.map((status) => (
              <StatusChip key={status.kind} status={status} />
            ))}
          </span>

          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {segments.map((segment, index) => (
              <Fragment key={segment.key}>
                {index > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      "shrink-0",
                      segment.wideOnly && "hidden lg:inline"
                    )}
                  >
                    ·
                  </span>
                )}
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-1",
                    segment.wideOnly && "hidden lg:flex"
                  )}
                >
                  {segment.node}
                </span>
              </Fragment>
            ))}
          </span>
        </span>

        {/* Trailing measures. The mention count is the first thing to go when
            the row narrows: it is context, where the last touch answers "is
            this relationship going cold?". */}
        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden items-center gap-1 tabular-nums md:flex">
            <MessageSquare className="size-3.5" aria-hidden />
            {entity.mention_count}
            <span className="sr-only">
              {entity.mention_count === 1 ? "mention" : "mentions"}
            </span>
          </span>
          {touch && (
            <span className="min-w-14 whitespace-nowrap text-right tabular-nums">
              <span className="sr-only">last touch </span>
              {touch}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function Channel({
  channel,
}: {
  channel: { kind: string; value: string };
}) {
  const Icon = CHANNEL_ICONS[channel.kind];
  return (
    <>
      {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{channel.value}</span>
    </>
  );
}

/**
 * A status, at whatever size the viewport allows.
 *
 * The full wording lives in an always-present `sr-only` span and in `title`,
 * and the visible label is `aria-hidden` — so the meaning is in the accessible
 * name at 320px where only the icon shows, and is never announced twice at the
 * width where both are present.
 */
function StatusChip({ status }: { status: ContactStatus }) {
  const Icon = STATUS_ICONS[status.kind];
  const full = status.detail
    ? `${status.label}: ${status.detail}`
    : status.label;
  // For a compartment the specifics *are* the point — "legal" says more in the
  // same space than "Restricted".
  const visible = status.kind === "restricted" && status.detail
    ? status.detail
    : status.label;

  return (
    <span
      title={full}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-xs font-normal",
        STATUS_CLASSES[status.kind]
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">{full}</span>
      <span aria-hidden className="hidden whitespace-nowrap md:inline">
        {visible}
      </span>
    </span>
  );
}
