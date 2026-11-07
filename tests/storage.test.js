import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { dataDirectory } from "../storage.js";
import { testPaymentService } from "../payments.js";
process.env.NODE_ENV = "test";
const { createDb } = await import("../server.js");

test("persistent path retains stock, orders and payment idempotency on restart", async () => {
  const old = process.env.ROASTORY_DATA_DIRECTORY;
  const directory = mkdtempSync(join(tmpdir(), "roastory-disk-"));
  let db;
  try {
    process.env.ROASTORY_DATA_DIRECTORY = directory;
    db = createDb();
    db.prepare("UPDATE products SET stock=7 WHERE id=1").run();
    db.prepare("INSERT INTO orders(customer,email,total,status,created_at,request_key) VALUES(?,?,?,?,?,?)")
      .run("Synthetic fixture", "fixture@example.test", 1090, "new", new Date().toISOString(), "fixture-request");
    const config = { shop: "1", key: "test_fixture", returnUrl: "https://shop.example.test/" };
    const send = async (_url, options) => {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "fixture-payment", test: true, status: "pending", amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: "https://yoomoney.ru/checkout/fixture" } }));
    };
    const first = await testPaymentService(db, { config, send }).create(1, 109000, "Fixture");
    db.close(); db = createDb();
    assert.ok(existsSync(join(directory, "roastory.db")));
    assert.equal(db.prepare("SELECT stock FROM products WHERE id=1").get().stock, 7);
    assert.equal(db.prepare("SELECT request_key FROM orders WHERE id=1").get().request_key, "fixture-request");
    const repeated = await testPaymentService(db, { config, send: () => { throw new Error("Must not create a second payment"); } }).create(1, 109000, "Fixture");
    assert.equal(repeated.idempotence_key, first.idempotence_key);
    assert.equal(repeated.provider_id, first.provider_id);
    process.env.ROASTORY_DATA_DIRECTORY = resolve("public", "data");
    assert.throws(dataDirectory, /outside the public/);
  } finally {
    if (db?.isOpen) db.close();
    if (old === undefined) delete process.env.ROASTORY_DATA_DIRECTORY;
    else process.env.ROASTORY_DATA_DIRECTORY = old;
    rmSync(directory, { recursive: true, force: true });
  }
});
