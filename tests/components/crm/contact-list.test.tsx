/**
 * A smoke test for the dense Rolodex list.
 *
 * The pure logic is covered in `tests/lib/crm/contact-list.test.ts`; what is
 * worth checking here is the part a unit test cannot see — that the row is
 * still a real list of links, and that the three statuses a user has to act on
 * are in the accessible name at every width, including the narrow one where
 * only the icon is painted.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ContactList, type ContactListRow } from "@/components/crm/contact-list";

// The app router context is not present in jsdom, and the row only needs Link
// to be an anchor with an href.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function contact(overrides: Partial<ContactListRow> = {}): ContactListRow {
  return {
    entity: {
      id: "ent_1",
      canonical_name: "Dana Okonkwo",
      entity_type: "person",
      mention_count: 12,
      last_seen_at: "2026-09-17 09:00:00",
    },
    compartments: ["public"],
    resolution: "confirmed",
    needsReview: false,
    channels: [],
    roles: [],
    lastInteractionAt: null,
    ...overrides,
  };
}

describe("ContactList", () => {
  it("renders one list item per contact, each a link to the contact", () => {
    render(
      <ContactList
        contacts={[
          contact(),
          contact({
            entity: {
              id: "ent_2",
              canonical_name: "Northwind Farms",
              entity_type: "org",
              mention_count: 3,
              last_seen_at: "2026-09-10 09:00:00",
            },
          }),
        ]}
      />
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: /Dana Okonkwo/ })
    ).toHaveAttribute("href", "/crm/ent_1");
    expect(
      screen.getByRole("link", { name: /Northwind Farms/ })
    ).toHaveAttribute("href", "/crm/ent_2");
  });

  it("sections alphabetically, with the # bucket last", () => {
    render(
      <ContactList
        contacts={[
          contact({
            entity: {
              id: "ent_3",
              canonical_name: "3M",
              entity_type: "org",
              mention_count: 1,
              last_seen_at: "2026-09-10 09:00:00",
            },
          }),
          contact(),
        ]}
      />
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["D", "#"]);
  });

  it("keeps every pending decision in the row's accessible name", () => {
    render(
      <ContactList
        contacts={[
          contact({
            resolution: "unresolved",
            needsReview: true,
            compartments: ["public", "legal"],
          }),
        ]}
      />
    );

    const link = screen.getByRole("link", { name: /Dana Okonkwo/ });
    expect(link).toHaveTextContent("Unresolved");
    expect(link).toHaveTextContent("Possible duplicate");
    expect(link).toHaveTextContent("Restricted: legal");
  });

  it("says nothing about a contact with nothing pending", () => {
    render(<ContactList contacts={[contact()]} />);
    const link = screen.getByRole("link", { name: /Dana Okonkwo/ });
    expect(link).not.toHaveTextContent("Unresolved");
    expect(link).not.toHaveTextContent("Restricted");
  });

  it("shows the role, the primary channel and the last touch", () => {
    render(
      <ContactList
        contacts={[
          contact({
            channels: [
              { kind: "phone", value: "+44 7700 900000", is_primary: 0 },
              { kind: "email", value: "dana@northwind.test", is_primary: 1 },
            ],
            roles: [
              { ventureId: "v1", ventureName: "Northwind", edgeType: "partner" },
              { ventureId: "v2", ventureName: "Fieldtech", edgeType: "advisor_to" },
            ],
            lastInteractionAt: new Date(
              Date.now() - 3 * 86_400_000
            ).toISOString(),
          }),
        ]}
      />
    );

    const link = screen.getByRole("link", { name: /Dana Okonkwo/ });
    // The flagged-primary channel wins over the phone number listed first.
    expect(link).toHaveTextContent("dana@northwind.test");
    // One role, plus a count of the ones that did not fit.
    expect(link).toHaveTextContent("Partner · Northwind +1");
    expect(link).toHaveTextContent("3d");
  });

  it("falls back to the mention count when there is nothing else to say", () => {
    render(<ContactList contacts={[contact()]} />);
    const item = within(screen.getByRole("listitem"));
    expect(item.getByText("12 mentions")).toBeInTheDocument();
  });
});
