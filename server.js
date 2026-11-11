import { adaptDatabase, createPostgres } from "./database.js";
import { initializePayments, testPaymentService } from "./payments.js";
import { dataDirectory } from "./storage.js";
import {ownerAccess,publicOrigin} from "./owner-access.js";
import { consumeBudget, initializeBudgets } from "./request-budget.js";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const root = dirname(fileURLToPath(import.meta.url));
export function createDb(file = resolve(dataDirectory(), "roastory.db")) {
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
    const productColumns = db.prepare("PRAGMA table_info(products)").all().map(c => c.name);
    if (!productColumns.includes('stock')) {
      db.exec('ALTER TABLE products ADD COLUMN stock INTEGER CHECK(stock IS NULL OR stock >= 0)');
      if (!initialized) db.exec('UPDATE products SET stock=100');
    }
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
    initializePayments(db);
    initializeBudgets(db);
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}
export function createApp(db = createDb(), { now = Date.now, paymentOptions } = {}) {
  db = adaptDatabase(db);
  const app = express();
  const hostedOrigin=publicOrigin();
  const payments=testPaymentService(db, paymentOptions);
  const retentionDays=Number(process.env.CONTACT_RETENTION_DAYS || 90);
  if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>3650)throw new Error('Invalid retention');
  let swept=-Infinity;
  app.use('/api',async(_req,_res,next)=>{const time=now();if(time-swept>=3600000){await db.prepare("UPDATE orders SET customer='[removed]',email='' WHERE created_at<? AND email!=''").run(new Date(time-retentionDays*86400000).toISOString());swept=time;}next();});
  app.use("/api", (req, res, next) => {
    if (hostedOrigin ? req.get("host") !== hostedOrigin.host : !["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname))
      return res.status(403).json({ message: "Используйте локальный адрес" });
    if (
      !["GET","HEAD","OPTIONS"].includes(req.method) &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") &&
          req.get("origin") !== (hostedOrigin?.origin || `${req.protocol}://${req.get("host")}`)))
    )
      return res
        .status(403)
        .json({ message: "Запрос с другого сайта запрещён" });
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.param("id", (req, res, next, id) =>
    /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
      ? next()
      : res.status(400).json({ message: "Некорректный идентификатор" }),
  );
  app.get("/api/products", async (req, res) => {
    const parsed = z
      .object({ process: z.string().max(80).default("") })
      .strict()
      .safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: "Проверьте фильтр" });
    const { process } = parsed.data;
    const rows =
      process && process !== "all"
        ? await db
            .prepare("SELECT * FROM products WHERE process=? AND available=1")
            .all(process)
        : await db.prepare("SELECT * FROM products WHERE available=1").all();
    res.json(rows);
  });
  app.get("/api/products/:id", async (req, res) => {
    const p = await db
      .prepare("SELECT * FROM products WHERE id=? AND available=1")
      .get(Number(req.params.id));
    return p ? res.json(p) : res.status(404).json({ message: "Лот не найден" });
  });
  app.post("/api/orders", async (req, res) => {
    const time = now();
    const budget = await consumeBudget(db, 'submit', 20, time);
    if (!budget.allowed) return res.set('Retry-After', String(budget.retryAfter)).status(429).json({ message: 'Слишком много запросов. Повторите позже' });
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
    const key = req.get("Idempotency-Key") ?? randomUUID();
    if (key !== null && !/^[A-Za-z0-9_-]{8,100}$/.test(key))
      return res.status(400).json({ message: "Некорректный ключ операции" });
    const hash = createHash("sha256")
      .update(JSON.stringify(p.data))
      .digest("hex");
    const result = await db.transaction(async () => {
      const previous = await db.prepare('SELECT id,total,status,request_hash FROM orders WHERE request_key=?').get(key);
      if(previous) return previous.request_hash===hash
        ? {code:200,body:{id:previous.id,total:previous.total,status:previous.status,accessKey:key}}
        : {code:409,body:{message:'Ключ операции уже использован с другими данными'}};
      let total=0; const items=[];
      // Validate the whole cart before changing any stock.
      for(const item of p.data.items) {
        const product=await db.prepare('SELECT id,price,available,stock FROM products WHERE id=?'+(db.kind==='postgres'?' FOR UPDATE':'')).get(item.productId);
        if(!product || !product.available)return {code:400,body:{message:'Один из товаров недоступен'}};
        if(!Number.isSafeInteger(product.price)||product.price<=0||product.price>1000000)throw new Error('Invalid catalog price');
        if(product.stock===null||product.stock<item.quantity)return {code:409,body:{message:'Недостаточно подтверждённых остатков'}};
        total+=product.price*item.quantity;items.push({...item,price:product.price});
      }
      if(!Number.isSafeInteger(total))throw new Error('Invalid order total');
      for(const item of items) await db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(item.quantity,item.productId);
      const out=await db.prepare("INSERT INTO orders(customer,email,total,status,created_at,request_key,request_hash) VALUES(?,?,?,'new',?,?,?)").run(p.data.customer,p.data.email,total,new Date(time).toISOString(),key,hash);
      for(const item of items)await db.prepare('INSERT INTO order_items VALUES(?,?,?,?)').run(out.lastInsertRowid,item.productId,item.quantity,item.price);
      return {code:201,body:{id:Number(out.lastInsertRowid),total,status:'new',accessKey:key}};
    });
    res.status(result.code).json(result.body);
  });
  app.get("/api/orders/:id", async (req, res) => {
    const allowed = await db.prepare('SELECT request_key FROM orders WHERE id=?').get(Number(req.params.id));
    const supplied=req.get('X-Order-Key') || '';
    if(!allowed || !allowed.request_key || !supplied || createHash('sha256').update(supplied).digest('hex') !== createHash('sha256').update(allowed.request_key).digest('hex')) return res.status(404).json({message:'Заказ не найден'});
    const o = await db
      .prepare("SELECT id,total,status,created_at FROM orders WHERE id=?")
      .get(Number(req.params.id));
    return o
      ? res.json(o)
      : res.status(404).json({ message: "Заказ не найден" });
  });
  const buyer=async(req,res,next)=>{const row=await db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));if(!row||!row.request_key||req.get('X-Order-Key')!==row.request_key)return res.status(404).json({message:'Заказ не найден'});req.order=row;next();};
  const reconcilePayment = async (orderId, status) => db.transaction(async () => {
    if (status === 'succeeded') {
      await db.prepare("UPDATE orders SET status='paid' WHERE id=? AND status!='canceled'").run(orderId);
    } else if (status === 'canceled') {
      const changed = await db.prepare("UPDATE orders SET status='canceled' WHERE id=? AND status NOT IN ('paid','canceled')").run(orderId);
      if (changed.changes) {
        const items = await db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(orderId);
        for (const item of items) await db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity,item.product_id);
      }
    }
  });
  app.post('/api/orders/:id/payment',buyer,async(req,res)=>{
    if(!payments.enabled)return res.status(503).json({message:'Тестовая оплата не настроена'});
    if(req.order.status==='canceled')return res.status(409).json({message:'Заказ отменён'});
    const result=await payments.create(req.order.id,req.order.total*100,'Roastory: тестовая оплата заказа '+req.order.id);
    res.json({test:true,status:result.status,confirmationUrl:result.confirmation_url});
  });
  app.post('/api/orders/:id/payment/refresh',buyer,async(req,res)=>{
    const result=await payments.refresh(req.order.id);if(!result)return res.status(404).json({message:'Платёж не найден'});
    await reconcilePayment(req.order.id,result.status);
    res.json({test:true,status:result.status});
  });
  app.post('/api/orders/:id/payment/cancel',buyer,async(req,res)=>{
    if(!payments.enabled)return res.status(503).json({message:'Тестовая оплата не настроена'});
    const result=await payments.cancel(req.order.id);if(!result)return res.status(404).json({message:'Платёж не найден'});
    await reconcilePayment(req.order.id,result.status);
    if(result.status!=='canceled')return res.status(409).json({test:true,status:result.status,message:result.status==='pending'?'Платёж ожидает подтверждения покупателя; отмена пока недоступна':'Платёж уже завершён; отмена недоступна'});
    res.json({test:true,status:result.status});
  });
  app.get('/api/owner/orders',ownerAccess(),async(_req,res)=>res.json(await db.prepare('SELECT id,customer,email,total,status,created_at FROM orders ORDER BY id DESC LIMIT 100').all()));
  app.patch('/api/owner/products/:id/stock',ownerAccess(),async(req,res)=>{
    const p=z.object({stock:z.number().int().min(0).max(1000000),expectedStock:z.number().int().min(0).nullable()}).strict().safeParse(req.body);
    if(!p.success)return res.status(400).json({message:'Проверьте остаток'});
    const result=await db.prepare('UPDATE products SET stock=? WHERE id=? AND stock IS ?').run(p.data.stock,Number(req.params.id),p.data.expectedStock);
    if(!result.changes)return res.status(409).json({message:'Остаток уже изменён. Обновите данные.'});
    res.json({ok:true,stock:p.data.stock});
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
    !process.env.APP_PUBLIC_ORIGIN && process.env.HOST &&
    !["localhost", "127.0.0.1", "::1"].includes(process.env.HOST)
  )
    throw new Error("Roastory requires a loopback HOST");
  createApp(process.env.DATABASE_URL ? await createPostgres() : createDb()).listen(
    process.env.PORT || 4500,
    process.env.HOST || "127.0.0.1",
    () => console.log("Roastory: http://localhost:4500"),
  );
}

