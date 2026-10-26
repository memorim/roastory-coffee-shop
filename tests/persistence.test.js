import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
process.env.NODE_ENV = "test";
const { createDb } = await import("../server.js");
test(
  "two independent servers persist exactly one order for a retry key",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "roastory-concurrency-")),
      file = join(directory, "orders.db"),
      children = [];
    try {
      const urls = await Promise.all(
        [1, 2].map(async () => {
          const child = fork(
            new URL("./fixtures/order-server.js", import.meta.url),
            [file],
            {
              env: { ...process.env, NODE_ENV: "test" },
              stdio: ["ignore", "ignore", "pipe", "ipc"],
              windowsHide: true,
            },
          );
          children.push(child);
          const [data] = await once(child, "message");
          return "http://127.0.0.1:" + data.port;
        }),
      );
      const responses = await Promise.all(
        urls.map((url) =>
          fetch(url + "/api/orders", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": "cross-process-retry",
            },
            body: JSON.stringify({
                customer: "Concurrency fixture",
                email: "fixture@example.test",
                items: [{productId:1,quantity:2}],
            }),
          }),
        ),
      );
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
      const values = await Promise.all(responses.map((r) => r.json()));
      assert.equal(values[0].id, values[1].id);
      await Promise.all(
        children.map(async (child) => {
          const exited = once(child, "exit");
          child.send("stop");
          await exited;
        }),
      );
      const db = createDb(file);
      try {
        assert.equal(db.prepare("SELECT COUNT(*) n FROM products").get().n, 6);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n, 1);
        assert.equal(
          db.prepare("PRAGMA integrity_check").get().integrity_check,
          "ok",
        );
      } finally {
        db.close();
      }
    } finally {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode === null) {
            const exited = once(child, "exit");
            child.kill();
            await exited;
          }
        }),
      );
      assert.ok(resolve(directory).startsWith(resolve(tmpdir())));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
