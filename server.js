import express from "express";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const root = dirname(fileURLToPath(import.meta.url));
export function createDb(file = resolve(root, "data", "roastory.db")) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    const initialized = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='products'",
      )
      .get();
    db.exec(
      `CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT,origin TEXT,process TEXT,notes TEXT,price INTEGER,score REAL,color TEXT,available INTEGER);CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,customer TEXT,email TEXT,total INTEGER,status TEXT,created_at TEXT);CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER,product_id INTEGER,quantity INTEGER,price INTEGER);`,
    );
    if (!initialized)
      db.exec(
        `INSERT INTO products VALUES(1,'Kayon Mountain','Эфиопия','Натуральная','бергамот · черника · какао',1090,4.9,'#d9653b',1),(2,'El Mirador','Колумбия','Мытая','красное яблоко · карамель',990,4.8,'#65805c',1),(3,'Los Pirineos','Сальвадор','Хани','абрикос · миндаль · мёд',1190,4.9,'#d29f48',1),(4,'Karatu Estate','Танзания','Мытая','смородина · чай · лайм',1050,4.7,'#725e8d',1),(5,'Serra Negra','Бразилия','Натуральная','фундук · шоколад · вишня',890,4.8,'#9b6047',1),(6,'Decaf Popayán','Колумбия','Sugarcane decaf','мандалин · ирис · какао',1150,4.6,'#53827c',1);`,
      );
    const columns = db
      .prepare("PRAGMA table_info(orders)")
      .all()
      .map((c) => c.name);
    for (const column of ["request_key", "request_hash"])
      if (!columns.includes(column))
        db.exec(`ALTER TABLE orders ADD COLUMN ${column} TEXT`);
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS orders_request_key ON orders(request_key); COMMIT",
    );
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}
export function createApp(db = createDb(), { now = Date.now } = {}) {
  const app = express();
  app.use("/api", (req, res, next) => {
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname))
      return res.status(403).json({ message: "Используйте локальный адрес" });
    if (
      req.method === "POST" &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") &&
          req.get("origin") !== `${req.protocol}://${req.get("host")}`))
    )
      return res
        .status(403)
        .json({ message: "Запрос с другого сайта запрещён" });
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  let attempts = 0,
    reset = 0;
  app.param("id", (req, res, next, id) =>
    /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
      ? next()
      : res.status(400).json({ message: "Некорректный идентификатор" }),
  );
  app.get("/api/products", (req, res) => {
    const parsed = z
      .object({ process: z.string().max(80).default("") })
      .strict()
      .safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: "Проверьте фильтр" });
    const { process } = parsed.data;
    const rows =
      process && process !== "all"
        ? db
            .prepare("SELECT * FROM products WHERE process=? AND available=1")
            .all(process)
        : db.prepare("SELECT * FROM products WHERE available=1").all();
    res.json(rows);
  });
  app.get("/api/products/:id", (req, res) => {
    const p = db
      .prepare("SELECT * FROM products WHERE id=? AND available=1")
      .get(Number(req.params.id));
    return p ? res.json(p) : res.status(404).json({ message: "Лот не найден" });
  });
  app.post("/api/orders", (req, res) => {
    const time = now();
    if (time >= reset) {
      attempts = 0;
      reset = time + 60000;
    }
    // ponytail: local-process budget only; external hosting needs shared abuse controls.
    if (attempts++ >= 20)
      return res
        .set(
          "Retry-After",
          String(Math.max(1, Math.ceil((reset - time) / 1000))),
        )
        .status(429)
        .json({ message: "Слишком много заказов. Повторите позже" });
    const schema = z.object({
      customer: z.string().trim().min(2).max(80),
      email: z.string().trim().email().max(254),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            quantity: z.number().int().positive().max(10),
          }),
        )
        .min(1)
        .max(50)
        .refine(
          (items) =>
            new Set(items.map((i) => i.productId)).size === items.length,
        ),
    });
    const p = schema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Проверьте заказ" });
    const key = req.get("Idempotency-Key") ?? null;
    if (key !== null && !/^[A-Za-z0-9_-]{8,100}$/.test(key))
      return res.status(400).json({ message: "Некорректный ключ операции" });
    const hash = createHash("sha256")
      .update(JSON.stringify(p.data))
      .digest("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = key
        ? db
            .prepare(
              "SELECT id,total,status,request_hash FROM orders WHERE request_key=?",
            )
            .get(key)
        : null;
      if (previous) {
        db.exec("ROLLBACK");
        return previous.request_hash === hash
          ? res.json({
              id: previous.id,
              total: previous.total,
              status: previous.status,
            })
          : res.status(409).json({
              message: "Ключ операции уже использован с другими данными",
            });
      }
      let total = 0;
      const items = [];
      for (const item of p.data.items) {
        const product = db
          .prepare("SELECT id,price,available FROM products WHERE id=?")
          .get(item.productId);
        if (!product || !product.available) {
          db.exec("ROLLBACK");
          return res
            .status(400)
            .json({ message: "Один из товаров недоступен" });
        }
        if (
          !Number.isSafeInteger(product.price) ||
          product.price <= 0 ||
          product.price > 1000000
        )
          throw new Error("Invalid catalog price");
        total += product.price * item.quantity;
        items.push({ ...item, price: product.price });
      }
      if (!Number.isSafeInteger(total)) throw new Error("Invalid order total");
      const out = db
        .prepare(
          `INSERT INTO orders(customer,email,total,status,created_at,request_key,request_hash) VALUES(?,?,?,'new',?,?,?)`,
        )
        .run(
          p.data.customer,
          p.data.email,
          total,
          new Date(time).toISOString(),
          key,
          hash,
        );
      const add = db.prepare("INSERT INTO order_items VALUES(?,?,?,?)");
      items.forEach((i) =>
        add.run(out.lastInsertRowid, i.productId, i.quantity, i.price),
      );
      db.exec("COMMIT");
      res
        .status(201)
        .json({ id: Number(out.lastInsertRowid), total, status: "new" });
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  });
  app.get("/api/orders/:id", (req, res) => {
    const o = db
      .prepare("SELECT id,total,status,created_at FROM orders WHERE id=?")
      .get(Number(req.params.id));
    return o
      ? res.json(o)
      : res.status(404).json({ message: "Заказ не найден" });
  });
  app.use(express.static(resolve(root, "public")));
  app.get(/^(?!\/api).*/, (_q, res) =>
    res.sendFile(resolve(root, "public", "index.html")),
  );
  app.use((error, _req, res, _next) => {
    const status =
      error?.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 400
          : 503;
    if (status === 503)
      console.error({ event: "request_error", error: "internal_error" });
    res.status(status).json({ message: "Не удалось обработать запрос" });
  });
  return app;
}
if (process.env.NODE_ENV !== "test") {
  if (
    process.env.HOST &&
    !["localhost", "127.0.0.1", "::1"].includes(process.env.HOST)
  )
    throw new Error("Roastory requires a loopback HOST");
  createApp().listen(
    process.env.PORT || 4500,
    process.env.HOST || "127.0.0.1",
    () => console.log("Roastory: http://localhost:4500"),
  );
}
