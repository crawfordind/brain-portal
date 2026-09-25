import { describe, it, expect, beforeAll } from "vitest";
import { useState } from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../helpers/render";
import { NoteLenses } from "@/components/lenses/note-lenses";
import { senseNote } from "@/lib/lenses/sense";
import { chooseLenses } from "@/lib/lenses/choose";
import { setTaskChecked } from "@/lib/lenses/blocks";

beforeAll(() => {
  // jsdom has neither; the line chart measures itself and tabs scroll into view.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

const NOTE = `<h2>Launch</h2>
<ul data-type="taskList">
  <li data-checked="false" data-type="taskItem"><div><p>Write the brief</p></div></li>
  <li data-checked="true" data-type="taskItem"><div><p>Pick a date</p></div></li>
</ul>
<h2>Budget</h2>
<p>Design: $4,000<br>Engineering: $12,000<br>Ads: $2,500</p>`;

/** The page's wiring in miniature: lenses follow the body, ticks write to it. */
function Harness({ initial, onBody }: { initial: string; onBody?: (b: string) => void }) {
  const [body, setBody] = useState(initial);
  const lenses = chooseLenses(senseNote(body), { today: "2026-09-25" });
  return (
    <NoteLenses
      noteId="n1"
      projectId={null}
      lenses={lenses}
      deepRead={null}
      isStale={false}
      canReadDeeper={false}
      isReading={false}
      onReadDeeper={() => {}}
      onToggleTask={(i, done) => {
        const next = setTaskChecked(body, i, done);
        setBody(next);
        onBody?.(next);
      }}
    >
      <div>EDITOR</div>
    </NoteLenses>
  );
}

describe("NoteLenses", () => {
  it("renders just the note when there is nothing to show another way", () => {
    renderWithProviders(<Harness initial="<p>Only a thought.</p>" />);
    expect(screen.getByText("EDITOR")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("offers a tab per lens and opens on the note", () => {
    renderWithProviders(<Harness initial={NOTE} />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[0]).toBe("Note");
    expect(tabs).toEqual(expect.arrayContaining(["To do", "Budget"]));
    expect(screen.getByText("EDITOR")).toBeVisible();
  });

  it("switches to a chart lens and explains the choice", () => {
    renderWithProviders(<Harness initial={NOTE} />);
    fireEvent.click(screen.getByRole("tab", { name: /Budget/ }));
    expect(screen.getByText(/Sorted bars put the biggest first/)).toBeInTheDocument();
    const labels = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(labels[0]).toMatch(/^Engineering/);
    expect(screen.getByText("EDITOR")).not.toBeVisible();
  });

  it("ticking a box in the checklist ticks it in the note", () => {
    let body = NOTE;
    renderWithProviders(<Harness initial={NOTE} onBody={(b) => (body = b)} />);
    fireEvent.click(screen.getByRole("tab", { name: /To do/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Mark "Write the brief" done/ }));
    expect(body).toContain('<li data-checked="true" data-type="taskItem"><div><p>Write the brief');
    expect(screen.getByText("2 of 2 done")).toBeInTheDocument();
  });
});
