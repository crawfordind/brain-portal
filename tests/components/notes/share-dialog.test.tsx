/**
 * The share dialog, as a phone user meets it: a visible way in from a list
 * row, a labelled Share button, a typo caught before it is sent, and no
 * one-tap way to break a public link someone was already given.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../helpers/render";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ShareNoteButton } from "@/components/notes/share-note-button";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function sharesResponse(publicLink: { url: string; sharedAt: string } | null = null) {
  return { shares: [], recipients: [], publicLink, accountSharingReady: true };
}

function renderButton() {
  return renderWithProviders(
    <ConfirmProvider>
      <ShareNoteButton noteId="note-1" slug="weekly-plan" title="Weekly plan" />
    </ConfirmProvider>
  );
}

const calls = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === method);

describe("ShareNoteButton + ShareDialog", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens the dialog for the note it sits beside, with a labelled Share button", async () => {
    fetchMock.mockImplementation(() => json(sharesResponse()));
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Share “Weekly plan”" }));

    expect(await screen.findByText("Share “Weekly plan”", { selector: "h2" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Share" })).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notes/note-1/shares");
  });

  it("catches a mistyped address without sending it", async () => {
    fetchMock.mockImplementation(() => json(sharesResponse()));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Share “Weekly plan”" }));

    const input = await screen.findByLabelText("Email of the account to share with");
    fireEvent.change(input, { target: { value: "colleague@example" } });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/full email address/);
    expect(calls("POST")).toHaveLength(0);
  });

  it("shares a valid address with the chosen permission", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ share: { id: "s1", recipient_email: "colleague@example.com", recipient_has_account: true }, created: true }, 201)
        : json(sharesResponse())
    );
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Share “Weekly plan”" }));

    fireEvent.change(await screen.findByLabelText("Email of the account to share with"), {
      target: { value: " colleague@example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(JSON.parse(calls("POST")[0][1].body)).toEqual({ email: "colleague@example.com", permission: "view" });
  });

  it("asks before turning off a public link, and leaves it on when cancelled", async () => {
    fetchMock.mockImplementation(() =>
      json(sharesResponse({ url: "https://app.example.com/shared/abc", sharedAt: "2026-10-19T00:00:00Z" }))
    );
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Share “Weekly plan”" }));

    fireEvent.click(await screen.findByRole("button", { name: /Turn off/ }));
    expect(await screen.findByText("Turn off the public link?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Turn off the public link?")).toBeNull());
    expect(calls("DELETE")).toHaveLength(0);
  });
});
