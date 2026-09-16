import { describe, it, expect } from "vitest";
import {
  extractTables,
  buildTableHtml,
  replaceTableAtIndex,
} from "@/lib/skills/table";

describe("extractTables", () => {
  it("extracts a simple table with thead and tbody", () => {
    const html = `
      <p>Some text</p>
      <table>
        <thead><tr><th>Name</th><th>Age</th></tr></thead>
        <tbody>
          <tr><td>Alice</td><td>30</td></tr>
          <tr><td>Bob</td><td>25</td></tr>
        </tbody>
      </table>
    `;

    const tables = extractTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["Name", "Age"]);
    expect(tables[0].rows).toEqual([
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("extracts multiple tables", () => {
    const html = `
      <table>
        <thead><tr><th>X</th></tr></thead>
        <tbody><tr><td>1</td></tr></tbody>
      </table>
      <p>gap</p>
      <table>
        <thead><tr><th>Y</th><th>Z</th></tr></thead>
        <tbody><tr><td>a</td><td>b</td></tr></tbody>
      </table>
    `;

    const tables = extractTables(html);
    expect(tables).toHaveLength(2);
    expect(tables[0].headers).toEqual(["X"]);
    expect(tables[1].headers).toEqual(["Y", "Z"]);
  });

  it("handles table without explicit thead/tbody", () => {
    const html = `
      <table>
        <tr><th>Col1</th><th>Col2</th></tr>
        <tr><td>val1</td><td>val2</td></tr>
      </table>
    `;

    const tables = extractTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["Col1", "Col2"]);
    expect(tables[0].rows).toEqual([["val1", "val2"]]);
  });

  it("returns empty array for HTML with no tables", () => {
    const html = "<p>No tables here</p>";
    const tables = extractTables(html);
    expect(tables).toEqual([]);
  });

  it("handles empty table", () => {
    const html = "<table><thead><tr><th>A</th></tr></thead><tbody></tbody></table>";
    const tables = extractTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["A"]);
    expect(tables[0].rows).toEqual([]);
  });

  it("trims cell whitespace", () => {
    const html = `
      <table>
        <thead><tr><th>  Name  </th></tr></thead>
        <tbody><tr><td>  Alice  </td></tr></tbody>
      </table>
    `;

    const tables = extractTables(html);
    expect(tables[0].headers).toEqual(["Name"]);
    expect(tables[0].rows).toEqual([["Alice"]]);
  });
});

describe("buildTableHtml", () => {
  it("builds valid HTML from table data", () => {
    const html = buildTableHtml({
      headers: ["Name", "Score"],
      rows: [
        ["Alice", "95"],
        ["Bob", "87"],
      ],
    });

    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<th>Score</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>Alice</td>");
    expect(html).toContain("<td>95</td>");
    expect(html).toContain("</table>");
  });

  it("escapes HTML special characters in cell content", () => {
    const html = buildTableHtml({
      headers: ["Formula"],
      rows: [["<script>alert('xss')</script>"]],
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles empty rows", () => {
    const html = buildTableHtml({
      headers: ["A", "B"],
      rows: [],
    });

    expect(html).toContain("<thead>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<tbody>");
  });
});

describe("replaceTableAtIndex", () => {
  const baseHtml = `
    <p>Before</p>
    <table><thead><tr><th>Old</th></tr></thead><tbody><tr><td>data</td></tr></tbody></table>
    <p>After</p>
  `;

  it("replaces the table at the given index", () => {
    const newTable = "<table><thead><tr><th>New</th></tr></thead><tbody></tbody></table>";
    const result = replaceTableAtIndex(baseHtml, 0, newTable);

    expect(result).toContain("<th>New</th>");
    expect(result).not.toContain("<th>Old</th>");
    expect(result).toContain("<p>Before</p>");
    expect(result).toContain("<p>After</p>");
  });

  it("throws for out-of-range index", () => {
    expect(() => replaceTableAtIndex(baseHtml, 5, "<table></table>")).toThrow(
      "out of range"
    );
  });

  it("replaces correct table when multiple exist", () => {
    const multiHtml = `
      <table><thead><tr><th>First</th></tr></thead><tbody></tbody></table>
      <table><thead><tr><th>Second</th></tr></thead><tbody></tbody></table>
    `;
    const replacement = "<table><thead><tr><th>Replaced</th></tr></thead><tbody></tbody></table>";
    const result = replaceTableAtIndex(multiHtml, 1, replacement);

    expect(result).toContain("<th>First</th>");
    expect(result).toContain("<th>Replaced</th>");
    expect(result).not.toContain("<th>Second</th>");
  });
});

describe("roundtrip: extract → build → extract", () => {
  it("preserves data through a build-then-extract cycle", () => {
    const original = {
      headers: ["Name", "Role", "Score"],
      rows: [
        ["Alice", "Engineer", "95"],
        ["Bob", "Designer", "88"],
      ],
    };

    const html = buildTableHtml(original);
    const extracted = extractTables(html);

    expect(extracted).toHaveLength(1);
    expect(extracted[0].headers).toEqual(original.headers);
    expect(extracted[0].rows).toEqual(original.rows);
  });
});
