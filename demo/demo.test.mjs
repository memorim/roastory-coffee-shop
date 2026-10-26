import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
function browser() {
  let offset = 0;
  class Clock extends Date {
    static now() {
      return Date.now() + offset;
    }
  }
  let network = 0;
  const scope = {
    DEMO_SEED: JSON.parse(
      readFileSync(new URL("./seed.json", import.meta.url), "utf8"),
    ),
    structuredClone,
    Response,
    Headers,
    URL,
    DOMException,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date: Clock,
    crypto: webcrypto,
    location: new URL("https://example.test/project/"),
    fetch: async () => {
      network++;
      throw Error("Unexpected network request");
    },
  };
  runInNewContext(
    readFileSync(new URL("./browser.js", import.meta.url), "utf8"),
    scope,
  );
  return {
    call: async (path, method = "GET", body, headers) => {
      const response = await scope.fetch(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers,
      });
      return { status: response.status, body: await response.json() };
    },
    advance: (ms) => {
      offset += ms;
    },
    network: () => network,
  };
}
test("price derives from catalog, quantity and idempotency are checked", async () => {
  const b = browser();
  const product = (await b.call("/api/products")).body[0];
  const payload = {
    customer: "Roman",
    email: "r@example.test",
    items: [{ productId: product.id, quantity: 2 }],
    total: 1,
  };
  const first = await b.call("/api/orders", "POST", payload, {
    "Idempotency-Key": "order",
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.total, product.price * 2);
  assert.equal(
    (
      await b.call("/api/orders", "POST", payload, {
        "Idempotency-Key": "order",
      })
    ).body.id,
    first.body.id,
  );
  assert.equal(
    (
      await b.call("/api/orders", "POST", {
        ...payload,
        items: [{ productId: product.id, quantity: 11 }],
      })
    ).status,
    400,
  );
  assert.equal(b.network(), 0);
});
