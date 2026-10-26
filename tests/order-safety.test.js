import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
process.env.NODE_ENV = "test";
const { createApp, createDb } = await import("../server.js");
const payload = {
  customer: "Order fixture",
  email: "fixture@example.test",
  items: [{ productId: 1, quantity: 2 }],
};
test("duplicate SKU cannot bypass per-product quantity limits", async () => {
  const db = createDb(":memory:");
  try {
    assert.equal(
      (
        await request(createApp(db))
          .post("/api/orders")
          .send({
            ...payload,
            items: [
              { productId: 1, quantity: 10 },
              { productId: 1, quantity: 10 },
            ],
          })
      ).status,
      400,
    );
  } finally {
    db.close();
  }
});
test("receipts do not disclose personal data", async () => {
  const db = createDb(":memory:"),
    app = createApp(db);
  try {
    const out = await request(app).post("/api/orders").send(payload);
    const receipt = await request(app).get("/api/orders/" + out.body.id);
    assert.equal(receipt.status, 200);
    assert.ok(!JSON.stringify(receipt.body).includes(payload.email));
    assert.ok(!JSON.stringify(receipt.body).includes(payload.customer));
  } finally {
    db.close();
  }
});

test("order bounds, server prices, idempotency and rollback are enforced", async () => {
  const db = createDb(":memory:"),
    app = createApp(db),
    logs = [],
    original = console.error;
  try {
    for (const invalid of [
      { customer: "  " },
      { customer: "x".repeat(81) },
      ...[-1, 0, 11, 1.5].map((quantity) => ({
        items: [{ productId: 1, quantity }],
      })),
      {
        items: Array.from({ length: 51 }, (_, i) => ({
          productId: i + 1,
          quantity: 1,
        })),
      },
    ])
      assert.equal(
        (
          await request(app)
            .post("/api/orders")
            .send({ ...payload, ...invalid })
        ).status,
        400,
      );
    const send = (body) =>
      request(app)
        .post("/api/orders")
        .set("Idempotency-Key", "same-checkout-key")
        .send(body);
    db.exec(
      "CREATE TRIGGER fail_position BEFORE INSERT ON order_items WHEN NEW.product_id=2 BEGIN SELECT RAISE(ABORT,'fixture@example.test');END",
    );
    console.error = (x) => logs.push(x);
    const body = {
      ...payload,
      items: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 },
      ],
    };
    assert.equal((await send(body)).status, 503);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM order_items").get().n, 0);
    assert.ok(!JSON.stringify(logs).includes(payload.email));
    db.exec("DROP TRIGGER fail_position");
    const created = await send({ ...body, total: 1, price: 1 });
    assert.equal(created.status, 201);
    assert.equal(created.body.total, 3170);
    db.exec("UPDATE products SET price=2000 WHERE id=1");
    const again = await send(body);
    assert.equal(again.status, 200);
    assert.equal(again.body.total, 3170);
    assert.equal(again.body.id, created.body.id);
    assert.equal(
      (await send({ ...body, customer: "Different customer" })).status,
      409,
    );
    assert.equal(
      db.prepare("SELECT SUM(quantity*price) total FROM order_items").get()
        .total,
      3170,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n, 1);
    for (const price of [-1, 1.5, Number.MAX_SAFE_INTEGER]) {
      db.prepare("UPDATE products SET price=? WHERE id=1").run(price);
      assert.equal(
        (await request(app).post("/api/orders").send(payload)).status,
        503,
      );
      assert.equal(db.isTransaction, false);
    }
    assert.equal(
      (
        await request(app)
          .post("/api/orders")
          .send({ ...payload, customer: "x".repeat(17000) })
      ).status,
      413,
    );
  } finally {
    console.error = original;
    db.close();
  }
});
