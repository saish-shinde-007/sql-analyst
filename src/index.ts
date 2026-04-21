import { existsSync } from "node:fs";
import { runAnalyst } from "./agent.js";
import { DB_PATH } from "./db.js";
import { seed } from "./seed.js";

const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  console.error('Usage: npm start -- "your question in English"');
  console.error('Examples:');
  console.error('  npm start -- "Top 5 customers by total revenue"');
  console.error('  npm start -- "Which product category has the highest average order value?"');
  console.error('  npm start -- "How many orders were placed last month?"');
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.log("No database found. Seeding a default dataset first...\n");
  seed();
  console.log("");
}

console.log(`Question: ${question}\n`);
await runAnalyst(question);
