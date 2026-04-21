import Database from "better-sqlite3";
import { faker } from "@faker-js/faker";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DB_PATH } from "./db.js";

export interface SeedOptions {
  customers: number;
  products: number;
  months: number;
  seed: number;
  out: string;
}

const DEFAULTS: SeedOptions = {
  customers: 50,
  products: 30,
  months: 18,
  seed: 42,
  out: DB_PATH,
};

const CATEGORIES = [
  { name: "Electronics", min: 40,  max: 500, count: 8 },
  { name: "Furniture",   min: 80,  max: 800, count: 6 },
  { name: "Apparel",     min: 30,  max: 200, count: 8 },
  { name: "Food",        min: 5,   max: 50,  count: 5 },
  { name: "Books",       min: 10,  max: 45,  count: 3 },
];

const STATUS_WEIGHTS: Array<[string, number]> = [
  ["delivered", 0.70],
  ["shipped",   0.15],
  ["pending",   0.10],
  ["cancelled", 0.05],
];

function weightedPick<T>(items: Array<[T, number]>): T {
  const r = faker.number.float({ min: 0, max: 1 });
  let acc = 0;
  for (const [item, w] of items) {
    acc += w;
    if (r <= acc) return item;
  }
  return items[items.length - 1]![0];
}

// Zipf-ish weight for customer activity: customer i gets weight 1/(i+1)
function zipfIndex(n: number): number {
  const r = faker.number.float({ min: 0, max: 1 });
  const harmonic = Array.from({ length: n }, (_, i) => 1 / (i + 1))
    .reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += (1 / (i + 1)) / harmonic;
    if (r <= acc) return i;
  }
  return n - 1;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function seed(opts: Partial<SeedOptions> = {}): SeedOptions {
  const o: SeedOptions = { ...DEFAULTS, ...opts };
  faker.seed(o.seed);

  mkdirSync(dirname(o.out), { recursive: true });
  if (existsSync(o.out)) rmSync(o.out);

  const db = new Database(o.out);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE customers (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      country     TEXT NOT NULL,
      signup_date TEXT NOT NULL
    );
    CREATE TABLE products (
      id       INTEGER PRIMARY KEY,
      name     TEXT NOT NULL,
      category TEXT NOT NULL,
      price    REAL NOT NULL
    );
    CREATE TABLE orders (
      id          INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_date  TEXT NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('pending','shipped','delivered','cancelled'))
    );
    CREATE TABLE order_items (
      id         INTEGER PRIMARY KEY,
      order_id   INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity   INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_items_order ON order_items(order_id);
  `);

  const now = new Date();
  const earliest = new Date(now);
  earliest.setMonth(earliest.getMonth() - o.months);

  const insCustomer = db.prepare("INSERT INTO customers VALUES (?, ?, ?, ?, ?)");
  const insProduct  = db.prepare("INSERT INTO products  VALUES (?, ?, ?, ?)");
  const insOrder    = db.prepare("INSERT INTO orders    VALUES (?, ?, ?, ?)");
  const insItem     = db.prepare("INSERT INTO order_items VALUES (?, ?, ?, ?, ?)");

  const run = db.transaction(() => {
    const seenEmails = new Set<string>();
    for (let i = 1; i <= o.customers; i++) {
      const name = faker.person.fullName();
      let email = faker.internet.email({ firstName: name.split(" ")[0] }).toLowerCase();
      while (seenEmails.has(email)) email = `${i}.${email}`;
      seenEmails.add(email);
      const country = faker.location.countryCode("alpha-2");
      const signup = faker.date.between({ from: earliest, to: now });
      insCustomer.run(i, name, email, country, isoDate(signup));
    }

    // Products: distribute across categories, scale the category's count to fit `products`
    const totalNominal = CATEGORIES.reduce((s, c) => s + c.count, 0);
    let pid = 1;
    const products: Array<{ id: number; price: number }> = [];
    for (const cat of CATEGORIES) {
      const n = Math.max(1, Math.round((cat.count / totalNominal) * o.products));
      for (let j = 0; j < n && pid <= o.products; j++, pid++) {
        const name = `${faker.commerce.productAdjective()} ${faker.commerce.product()}`;
        const price = Number(faker.number.float({ min: cat.min, max: cat.max, fractionDigits: 2 }));
        insProduct.run(pid, name, cat.name, price);
        products.push({ id: pid, price });
      }
    }
    while (pid <= o.products) {
      const cat = CATEGORIES[0]!;
      const name = `${faker.commerce.productAdjective()} ${faker.commerce.product()}`;
      const price = Number(faker.number.float({ min: cat.min, max: cat.max, fractionDigits: 2 }));
      insProduct.run(pid, name, cat.name, price);
      products.push({ id: pid, price });
      pid++;
    }

    // Orders: roughly 3x customers, zipf distribution so a few customers drive most revenue
    const orderCount = o.customers * 3;
    let itemId = 1;
    for (let oid = 1; oid <= orderCount; oid++) {
      const custIdx = zipfIndex(o.customers);
      const customerId = custIdx + 1;
      const date = faker.date.between({ from: earliest, to: now });
      const status = weightedPick(STATUS_WEIGHTS);
      insOrder.run(oid, customerId, isoDate(date), status);

      const lineCount = faker.number.int({ min: 1, max: 4 });
      const picked = new Set<number>();
      for (let k = 0; k < lineCount; k++) {
        let prod = products[faker.number.int({ min: 0, max: products.length - 1 })]!;
        while (picked.has(prod.id)) {
          prod = products[faker.number.int({ min: 0, max: products.length - 1 })]!;
        }
        picked.add(prod.id);
        const qty = faker.number.int({ min: 1, max: 3 });
        insItem.run(itemId++, oid, prod.id, qty, prod.price);
      }
    }
  });

  run();

  const counts = {
    customers:   (db.prepare("SELECT COUNT(*) AS n FROM customers").get()   as { n: number }).n,
    products:    (db.prepare("SELECT COUNT(*) AS n FROM products").get()    as { n: number }).n,
    orders:      (db.prepare("SELECT COUNT(*) AS n FROM orders").get()      as { n: number }).n,
    order_items: (db.prepare("SELECT COUNT(*) AS n FROM order_items").get() as { n: number }).n,
  };

  db.close();
  console.log(`Seeded ${o.out}`);
  console.log(`  customers=${counts.customers}  products=${counts.products}  orders=${counts.orders}  order_items=${counts.order_items}`);
  console.log(`  rng_seed=${o.seed}  months=${o.months}`);
  return o;
}

function parseArgs(argv: string[]): Partial<SeedOptions> {
  const out: Partial<SeedOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k?.startsWith("--")) continue;
    const key = k.slice(2);
    if (v === undefined || v.startsWith("--")) continue;
    if (key === "customers") out.customers = Number(v);
    else if (key === "products") out.products = Number(v);
    else if (key === "months") out.months = Number(v);
    else if (key === "seed") out.seed = Number(v);
    else if (key === "out") out.out = resolve(v);
    i++;
  }
  return out;
}

// CLI entry
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  seed(parseArgs(process.argv.slice(2)));
}
