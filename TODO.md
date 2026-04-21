# Stretch goals

Grow this into an interview-worthy portfolio piece.

## Evaluation harness (highest ROI)
- [ ] `evals/tasks.jsonl` with ~30 questions + expected SQL or expected answer
- [ ] `npm run evals` runs all tasks, scores:
  - correctness (does the answer match?)
  - SQL quality (uses JOIN vs N+1, respects indexes)
  - retries required (agent efficiency)
  - tokens + cost per question
- [ ] Publish a results table in the README — this is what makes the project stand out

## More guardrails
- [ ] Enforce `LIMIT` on unbounded queries (add one if missing)
- [ ] Query timeout (kill anything running > N seconds)
- [ ] Row-count cap on results returned to the agent (prevent context blowup)
- [ ] Per-column allowlist / PII masking (e.g. hash email before returning)

## Better self-correction
- [ ] When `run_sql` returns "no such column: X", include a list of columns from the relevant table in the error
- [ ] Track retry count in state; force the agent to stop after N and explain why

## Multi-database support
- [ ] Swap SQLite for Postgres (use `pg` with a readonly role)
- [ ] Config file that describes the DB: dialect, connection, allowed schemas
- [ ] Dialect-aware prompt (tell the model "you're writing Postgres" not just "SQL")

## UX
- [ ] `--explain` flag: agent shows the SQL and asks for confirmation before executing
- [ ] `--format table|json|csv` for the final output
- [ ] Web UI (Next.js) that streams the agent's thinking and shows results in a table
- [ ] Save each run as a `.session.json` for auditing

## Ops
- [ ] Dockerfile with the seeded DB baked in
- [ ] GitHub Actions: `npm run typecheck` + run evals on PRs
- [ ] Demo GIF at the top of the README
