import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { openDb } from "./db.js";
import { assertReadOnly } from "./guards.js";

const SYSTEM_PROMPT = `You are a SQL analyst agent working against a read-only SQLite database.

Your workflow for every user question:
1. Call list_tables to see what's available.
2. Call describe_table on each table you plan to query to learn its columns and see sample rows.
3. Write a single SELECT (or WITH ... SELECT) query that answers the question.
4. Call run_sql to execute it.
5. If run_sql returns an error, READ IT CAREFULLY, fix the query, and retry. Do not retry more than 3 times.
6. Once you have results, summarize them for the user in plain English — numbers first, then one sentence of interpretation.

Rules:
- Only SELECT / WITH queries. No INSERT, UPDATE, DELETE, or DDL — they will be rejected by the guardrail.
- Only one statement per run_sql call.
- Prefer explicit JOINs over subqueries when readable.
- Always qualify columns with their table when joining.
- When showing money, round to 2 decimal places.`;

const listTables = tool(
  "list_tables",
  "List all tables in the analytics database.",
  {},
  async () => {
    const db = openDb();
    try {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const text = rows.map((r) => r.name).join("\n");
      return { content: [{ type: "text", text }] };
    } finally {
      db.close();
    }
  }
);

const describeTable = tool(
  "describe_table",
  "Return column definitions and up to 3 sample rows for a given table.",
  { table: z.string().describe("Table name") },
  async (args) => {
    const db = openDb();
    try {
      // SQLite doesn't support binding identifiers, so validate the table name
      // against the schema before interpolating.
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(args.table);
      if (!exists) {
        return {
          content: [{ type: "text", text: `No such table: ${args.table}` }],
          isError: true,
        };
      }
      const cols = db.prepare(`PRAGMA table_info("${args.table}")`).all() as Array<{
        name: string; type: string; notnull: number; pk: number;
      }>;
      const schema = cols
        .map((c) => `  ${c.name} ${c.type}${c.pk ? " PRIMARY KEY" : ""}${c.notnull ? " NOT NULL" : ""}`)
        .join("\n");
      const sample = db.prepare(`SELECT * FROM "${args.table}" LIMIT 3`).all();
      const text =
        `TABLE ${args.table}\n${schema}\n\nSAMPLE ROWS:\n` +
        JSON.stringify(sample, null, 2);
      return { content: [{ type: "text", text }] };
    } finally {
      db.close();
    }
  }
);

const runSql = tool(
  "run_sql",
  "Run a single read-only SELECT/WITH query. Returns rows as JSON or an error the agent should fix.",
  { sql: z.string().describe("A single SELECT or WITH query. No trailing DDL/DML.") },
  async (args) => {
    try {
      assertReadOnly(args.sql);
    } catch (e) {
      return {
        content: [{ type: "text", text: `GUARDRAIL BLOCKED: ${(e as Error).message}` }],
        isError: true,
      };
    }

    const db = openDb();
    try {
      const rows = db.prepare(args.sql).all();
      const preview = rows.slice(0, 50);
      const truncatedNote = rows.length > 50 ? `\n(truncated: showing 50 of ${rows.length} rows)` : "";
      const text = `ROWS: ${rows.length}\n${JSON.stringify(preview, null, 2)}${truncatedNote}`;
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `SQL ERROR: ${(e as Error).message}` }],
        isError: true,
      };
    } finally {
      db.close();
    }
  }
);

const sqlServer = createSdkMcpServer({
  name: "sql",
  version: "0.1.0",
  tools: [listTables, describeTable, runSql],
});

export async function runAnalyst(userQuestion: string): Promise<void> {
  const stream = query({
    prompt: userQuestion,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { sql: sqlServer },
      allowedTools: [
        "mcp__sql__list_tables",
        "mcp__sql__describe_table",
        "mcp__sql__run_sql",
      ],
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
        if (block.type === "tool_use") {
          const args = JSON.stringify(block.input);
          process.stdout.write(`\n[tool: ${block.name} ${args}]\n`);
        }
      }
    }
    if (message.type === "result" && "result" in message) {
      process.stdout.write(`\n\n--- done ---\n${message.result}\n`);
    }
  }
}
