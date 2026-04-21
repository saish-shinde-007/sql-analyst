const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
  "GRANT", "REVOKE", "REPLACE", "ATTACH", "DETACH", "PRAGMA", "VACUUM", "REINDEX",
];

function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

export function assertReadOnly(sql: string): void {
  const stripped = stripCommentsAndStrings(sql).trim();

  if (!stripped) throw new Error("Query rejected: empty SQL.");

  // Reject multiple statements — prevents `SELECT 1; DROP TABLE x;`
  const withoutTrailingSemi = stripped.replace(/;\s*$/, "");
  if (withoutTrailingSemi.includes(";")) {
    throw new Error("Query rejected: only a single statement is allowed per call.");
  }

  const upper = stripped.toUpperCase();
  const forbiddenRe = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join("|")})\\b`, "i");
  const match = forbiddenRe.exec(stripped);
  if (match) {
    throw new Error(
      `Query rejected: forbidden keyword "${match[1]?.toUpperCase()}". Only SELECT / WITH queries are allowed.`
    );
  }

  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    throw new Error(
      `Query rejected: must start with SELECT or WITH, got: "${upper.slice(0, 30)}..."`
    );
  }
}
