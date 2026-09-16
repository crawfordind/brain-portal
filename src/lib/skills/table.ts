/**
 * manage_table Skill
 *
 * Provides agents with the ability to create, read, update, and query
 * HTML tables embedded in note content. Tables are stored inline as
 * standard HTML <table> elements within the note's content column.
 */

import { parse as parseHtml } from "node-html-parser";
import type { SkillHandler, SkillDefinition } from "./registry";
import { queryOne, mutate } from "@/lib/db/client";

// ─── Types ──────────────────────────────────────────

interface NoteRow {
  id: string;
  content: string;
  user_id: string;
}

interface TableData {
  headers: string[];
  rows: string[][];
}

// ─── HTML Table Helpers ─────────────────────────────

function extractTables(html: string): TableData[] {
  const root = parseHtml(html);
  const tables = root.querySelectorAll("table");

  return tables.map((table) => {
    const headers: string[] = [];
    const rows: string[][] = [];

    // Extract headers from thead > tr > th, or first row th elements
    const headerCells = table.querySelectorAll("thead th, thead td");
    if (headerCells.length > 0) {
      headerCells.forEach((cell) => headers.push(cell.textContent.trim()));
    } else {
      // Fallback: first row might contain headers
      const firstRow = table.querySelector("tr");
      if (firstRow) {
        const ths = firstRow.querySelectorAll("th");
        if (ths.length > 0) {
          ths.forEach((cell) => headers.push(cell.textContent.trim()));
        }
      }
    }

    // Extract data rows from tbody, or all tr elements after headers
    const bodyRows = table.querySelectorAll("tbody tr");
    if (bodyRows.length > 0) {
      bodyRows.forEach((row) => {
        const cells: string[] = [];
        row.querySelectorAll("td, th").forEach((cell) =>
          cells.push(cell.textContent.trim())
        );
        rows.push(cells);
      });
    } else {
      // Fallback: all rows except the first (header) row
      const allRows = table.querySelectorAll("tr");
      allRows.forEach((row, idx) => {
        if (idx === 0 && headers.length > 0) return; // skip header row
        const cells: string[] = [];
        row.querySelectorAll("td, th").forEach((cell) =>
          cells.push(cell.textContent.trim())
        );
        rows.push(cells);
      });
    }

    return { headers, rows };
  });
}

function buildTableHtml(data: TableData): string {
  const headerRow = data.headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");
  const bodyRows = data.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
    )
    .join("\n");

  return `<table><thead><tr>${headerRow}</tr></thead><tbody>\n${bodyRows}\n</tbody></table>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function replaceTableAtIndex(
  html: string,
  tableIndex: number,
  newTableHtml: string
): string {
  const root = parseHtml(html);
  const tables = root.querySelectorAll("table");

  if (tableIndex < 0 || tableIndex >= tables.length) {
    throw new Error(
      `Table index ${tableIndex} out of range (note has ${tables.length} table(s))`
    );
  }

  tables[tableIndex].replaceWith(newTableHtml);
  return root.toString();
}

// ─── Action Handlers ────────────────────────────────

async function handleCreate(
  noteId: string,
  userId: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; output: unknown }> {
  const headers = params.headers as string[];
  const rows = (params.rows as string[][]) || [];

  if (!headers || headers.length === 0) {
    return { success: false, output: { error: "headers array is required for create" } };
  }

  // Pad rows to match header length
  const normalizedRows = rows.map((row) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push("");
    return padded.slice(0, headers.length);
  });

  const tableHtml = buildTableHtml({ headers, rows: normalizedRows });

  const note = await queryOne<NoteRow>(
    "SELECT id, content, user_id FROM notes WHERE id = ? AND user_id = ?",
    [noteId, userId]
  );

  if (!note) {
    return { success: false, output: { error: "Note not found or access denied" } };
  }

  const updatedContent = note.content + "\n" + tableHtml;

  await mutate(
    "UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?",
    [updatedContent, noteId]
  );

  const tables = extractTables(updatedContent);
  return {
    success: true,
    output: {
      table_index: tables.length - 1,
      headers,
      row_count: normalizedRows.length,
    },
  };
}

async function handleRead(
  noteId: string,
  userId: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; output: unknown }> {
  const tableIndex = (params.table_index as number) ?? 0;

  const note = await queryOne<NoteRow>(
    "SELECT id, content, user_id FROM notes WHERE id = ? AND user_id = ?",
    [noteId, userId]
  );

  if (!note) {
    return { success: false, output: { error: "Note not found or access denied" } };
  }

  const tables = extractTables(note.content);

  if (tables.length === 0) {
    return { success: false, output: { error: "No tables found in this note" } };
  }

  if (tableIndex < 0 || tableIndex >= tables.length) {
    return {
      success: false,
      output: {
        error: `Table index ${tableIndex} out of range (note has ${tables.length} table(s))`,
      },
    };
  }

  const table = tables[tableIndex];
  return {
    success: true,
    output: {
      table_index: tableIndex,
      total_tables: tables.length,
      headers: table.headers,
      rows: table.rows,
      row_count: table.rows.length,
    },
  };
}

async function handleUpdate(
  noteId: string,
  userId: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; output: unknown }> {
  const tableIndex = (params.table_index as number) ?? 0;
  const rowIndex = params.row_index as number | undefined;
  const data = params.data as Record<string, string>;

  if (!data) {
    return { success: false, output: { error: "data object is required for update" } };
  }

  const note = await queryOne<NoteRow>(
    "SELECT id, content, user_id FROM notes WHERE id = ? AND user_id = ?",
    [noteId, userId]
  );

  if (!note) {
    return { success: false, output: { error: "Note not found or access denied" } };
  }

  const tables = extractTables(note.content);

  if (tableIndex < 0 || tableIndex >= tables.length) {
    return {
      success: false,
      output: {
        error: `Table index ${tableIndex} out of range (note has ${tables.length} table(s))`,
      },
    };
  }

  const table = tables[tableIndex];

  // Build a new row from the data object, using header names as keys
  const newRow = table.headers.map((h) =>
    data[h] !== undefined ? String(data[h]) : ""
  );

  if (rowIndex !== undefined) {
    // Update existing row
    if (rowIndex < 0 || rowIndex >= table.rows.length) {
      return {
        success: false,
        output: {
          error: `Row index ${rowIndex} out of range (table has ${table.rows.length} row(s))`,
        },
      };
    }
    // Merge: only overwrite cells where data provides a value
    table.rows[rowIndex] = table.headers.map((h, i) =>
      data[h] !== undefined ? String(data[h]) : table.rows[rowIndex][i]
    );
  } else {
    // Append new row
    table.rows.push(newRow);
  }

  const newTableHtml = buildTableHtml(table);
  const updatedContent = replaceTableAtIndex(
    note.content,
    tableIndex,
    newTableHtml
  );

  await mutate(
    "UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?",
    [updatedContent, noteId]
  );

  return {
    success: true,
    output: {
      table_index: tableIndex,
      action: rowIndex !== undefined ? "updated_row" : "appended_row",
      row_index: rowIndex ?? table.rows.length - 1,
      row_count: table.rows.length,
    },
  };
}

async function handleQuery(
  noteId: string,
  userId: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; output: unknown }> {
  const tableIndex = (params.table_index as number) ?? 0;
  const filter = params.filter as Record<string, string> | undefined;
  const sortBy = params.sort_by as string | undefined;
  const sortOrder = (params.sort_order as string) || "asc";

  const note = await queryOne<NoteRow>(
    "SELECT id, content, user_id FROM notes WHERE id = ? AND user_id = ?",
    [noteId, userId]
  );

  if (!note) {
    return { success: false, output: { error: "Note not found or access denied" } };
  }

  const tables = extractTables(note.content);

  if (tableIndex < 0 || tableIndex >= tables.length) {
    return {
      success: false,
      output: {
        error: `Table index ${tableIndex} out of range (note has ${tables.length} table(s))`,
      },
    };
  }

  const table = tables[tableIndex];
  let resultRows = table.rows.map((row) => {
    const obj: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });

  // Apply filter
  if (filter) {
    resultRows = resultRows.filter((row) =>
      Object.entries(filter).every(([key, value]) =>
        row[key]?.toLowerCase().includes(String(value).toLowerCase())
      )
    );
  }

  // Apply sort
  if (sortBy && table.headers.includes(sortBy)) {
    resultRows.sort((a, b) => {
      const aVal = a[sortBy] ?? "";
      const bVal = b[sortBy] ?? "";
      // Try numeric comparison first
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortOrder === "desc" ? bNum - aNum : aNum - bNum;
      }
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === "desc" ? -cmp : cmp;
    });
  }

  return {
    success: true,
    output: {
      table_index: tableIndex,
      headers: table.headers,
      results: resultRows,
      total_matches: resultRows.length,
    },
  };
}

// ─── Skill Definition ───────────────────────────────

export const manageTableDef: SkillDefinition = {
  skillId: "manage_table",
  name: "Manage Table",
  description:
    "Create, read, update, and query HTML tables embedded in note content. " +
    "Tables are stored inline as standard HTML within notes.",
  category: "content",
  version: "1.0.0",
  inputSchema: {
    action: {
      type: "string",
      description: "The operation to perform on the table",
      required: true,
      enum: ["create", "read", "update", "query"],
    },
    note_id: {
      type: "string",
      description: "ID of the note containing (or to contain) the table",
      required: true,
    },
    table_index: {
      type: "number",
      description:
        "Zero-based index of which table in the note to target (default: 0)",
      default: 0,
    },
    headers: {
      type: "array",
      description: "Column header names (required for 'create' action)",
    },
    rows: {
      type: "array",
      description:
        "Initial data rows as array of arrays (optional for 'create')",
    },
    row_index: {
      type: "number",
      description:
        "Row index to update (for 'update' action; omit to append a new row)",
    },
    data: {
      type: "object",
      description:
        "Column-value pairs for update (e.g., {\"Name\": \"Alice\", \"Score\": \"95\"})",
    },
    filter: {
      type: "object",
      description:
        "Column-value filter criteria for 'query' (substring match, case-insensitive)",
    },
    sort_by: {
      type: "string",
      description: "Column name to sort results by (for 'query')",
    },
    sort_order: {
      type: "string",
      description: "Sort direction",
      enum: ["asc", "desc"],
      default: "asc",
    },
  },
  costTier: "free",
  requiresAuth: true,
  rateLimitPerHour: 60,
  tags: ["table", "spreadsheet", "data", "content"],
};

export const manageTableHandler: SkillHandler = async (params, context) => {
  const action = params.action as string;
  const noteId = params.note_id as string;

  if (!noteId) {
    return { success: false, output: { error: "note_id is required" } };
  }

  switch (action) {
    case "create":
      return handleCreate(noteId, context.userId, params);
    case "read":
      return handleRead(noteId, context.userId, params);
    case "update":
      return handleUpdate(noteId, context.userId, params);
    case "query":
      return handleQuery(noteId, context.userId, params);
    default:
      return {
        success: false,
        output: { error: `Unknown action: ${action}` },
      };
  }
};

// ─── Exported Helpers (for testing) ─────────────────

export { extractTables, buildTableHtml, replaceTableAtIndex };
