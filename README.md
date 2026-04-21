# SQL Analyst Agent

A natural-language → SQL agent built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). Ask questions in plain English; the agent inspects the schema, writes a SQL query, validates it against a read-only guardrail, runs it, and self-corrects on errors.

## What this demonstrates

- **Agentic self-correction** — when a query fails, the model sees the SQLite error and retries with a fix. The loop is emergent from tool-use, not hardcoded.
- **Guardrails in depth** — two independent layers block destructive queries:
  1. **Static SQL analysis** (`src/guards.ts`) — rejects any statement containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, `REVOKE`, `PRAGMA`, `VACUUM`, etc., or that contains multiple statements.
  2. **Read-only DB connection** (`src/db.ts`) — SQLite itself refuses writes, so even a bypass of the static check fails at the engine.
- **Tool design** — three small tools (`list_tables`, `describe_table`, `run_sql`) let the agent explore the schema before writing SQL. Good tool ergonomics > giving the model one giant tool.
- **Structured errors** — errors flow back to the agent as `isError: true` so it knows to retry, not give up.

## Architecture

```
          ┌─────────────────────────────────────┐
  user ─▶ │  src/index.ts  (CLI)                │
          └─────────────────┬───────────────────┘
                            ▼
          ┌─────────────────────────────────────┐
          │  src/agent.ts  (Claude Agent SDK)   │
          │  ┌───────────────────────────────┐  │
          │  │ Tools (MCP in-process server) │  │
          │  │  • list_tables                │  │
          │  │  • describe_table             │  │
          │  │  • run_sql ─┐                 │  │
          │  └─────────────┼─────────────────┘  │
          └────────────────┼────────────────────┘
                           ▼
          ┌─────────────────────────────────────┐
          │  src/guards.ts  assertReadOnly()    │ ◀── layer 1: static
          └─────────────────┬───────────────────┘
                            ▼
          ┌─────────────────────────────────────┐
          │  src/db.ts  SQLite (readonly: true) │ ◀── layer 2: engine
          └─────────────────┬───────────────────┘
                            ▼
                   data/analytics.db
```

## The dataset

A generated e-commerce schema. Defaults (50 customers / 30 products / ~150 orders over 18 months) give you enough variety to demo revenue-by-country, top products, churn, category analysis, etc.

| table       | notes                                                |
|-------------|------------------------------------------------------|
| customers   | generated with faker — name, email, country, signup  |
| products    | 5 categories (Electronics, Furniture, Apparel, Food, Books) with realistic price ranges |
| orders      | statuses: delivered / shipped / pending / cancelled (weighted) |
| order_items | 1–4 line items per order                              |

Customer activity follows a Zipf-like distribution — a small number of customers drive most of the revenue — so aggregations produce interesting results.

See [src/seed.ts](src/seed.ts) for the generator.

## Setup

```bash
cd sql-analyst
npm install
# (optional) seed with custom size — otherwise `npm start` auto-seeds on first run
npm run seed -- --customers 100 --products 50 --months 24 --seed 42
```

Everything is deterministic given `--seed` — use the same seed to get the same DB twice.

### Authentication

The Agent SDK needs Claude credentials. Try in this order:

1. **Existing Claude Code login** — if `claude` CLI is installed and logged in, the SDK may pick up those credentials. Just try running it.
2. **API key** — if that fails, create one at [console.anthropic.com](https://console.anthropic.com) (billed separately from Claude Max):
   ```bash
   cp .env.example .env
   # edit .env, then:
   export $(cat .env | xargs)
   ```

## Usage

```bash
npm start -- "Top 5 customers by total revenue"
npm start -- "Which product category has the highest average order value?"
npm start -- "How many orders were placed last month?"
npm start -- "Which customers have never placed an order?"
npm start -- "Show revenue by country, sorted descending"
```

If `data/analytics.db` doesn't exist, `npm start` seeds a default dataset automatically before running.

The agent will stream its reasoning: tool calls, SQL attempts, errors, retries, and finally a plain-English answer.

### See the guardrail in action

```bash
# These will all be blocked by assertReadOnly + readonly DB:
npm start -- "Delete all customers from India"
npm start -- "Drop the orders table"
npm start -- "Set every product's price to zero"
```

Watch the agent either refuse up front or get rejected by the guard and explain the policy to you.

## Project layout

```
sql-analyst/
├── src/
│   ├── index.ts       # CLI entry — auto-seeds if DB is missing
│   ├── agent.ts       # Claude Agent SDK wiring + tool definitions
│   ├── db.ts          # readonly SQLite connection
│   ├── guards.ts      # SQL safety validator (layer 1)
│   └── seed.ts        # faker-based generator — CLI + exported seed()
├── data/
│   └── analytics.db   # generated (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

## Extending it

See [TODO.md](TODO.md) — add evals, support Postgres, a web UI, more guardrails.
