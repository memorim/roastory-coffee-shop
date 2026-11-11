# Preserve orders, stock and payment references

`ROASTORY_DATA_DIRECTORY` selects the private directory containing `roastory.db`.
Set it to an attached persistent mount, for example `/var/lib/roastory`.
The default remains `data/` beside the application. A path under `public/` is
rejected. Merely setting the variable does not make an ephemeral directory durable.

Before switching an existing service:

1. Stop order and payment requests and stop the application.
2. Preserve the old database and copy the entire data directory, including any
   WAL/SHM files, to the persistent mount. Keep it private to the service user.
3. Set `ROASTORY_DATA_DIRECTORY`, restart one service instance and check existing
   orders, current stock and payment references. Do not initialise a fresh empty
   database in place of the old one.
4. Restart/redeploy again and confirm those records remain. Keep independent
   SQLite-consistent backups and test restoration before collecting real contacts.

The regression test closes and reopens the configured database, verifies stock
and order access keys, and proves a pending test payment retains its provider ID
and idempotency key without another creation request.

The free Render application filesystem is ephemeral; the deployed test service uses external PostgreSQL.
Attaching persistent storage requires access to its hosting configuration and an
explicit choice of an available hosting plan. No plan or disk is purchased by
this code change. Successful YooKassa sandbox checkout, return-to-store, server reconciliation and
paid-order persistence after restart were verified on 11 November 2026; see
[LIVE_PAYMENT_2026_11_11.md](LIVE_PAYMENT_2026_11_11.md). Provider cancellation remains
a separate live check. Real payment keys remain
prohibited and delivery remains outside the task.


## Free external PostgreSQL

Set `DATABASE_URL` in the hosting environment to use PostgreSQL instead of the
local SQLite file. Remote connections verify TLS certificates. The app initializes
its schema under a lock, and seeds the catalog only when the products table is
first created. Existing PostgreSQL stock is never reset during startup.

Orders, line items, stock, request budgets and test-payment idempotency records
share the external database. Checkout transactions serialize duplicate keys and
stock reservations across replicas. Product row locks also protect checkout from
concurrent owner inventory edits. Cancellation returns stock only for the first
successful order-status transition, including concurrent retries.

Local SQLite remains supported. Its statements are serialized while asynchronous
transactions run. This is not an automatic SQLite-to-PostgreSQL data migration.
The owner confirmed that all deployed data is test data, so the hosted rollout
can initialize a fresh external database without migrating old test orders.

Use a free Neon project instead of a paid Render disk. Stay within its free
storage, compute and transfer limits; do not upgrade automatically. DATABASE_URL
belongs in hosting secrets, never in this repository. CI uses PostgreSQL 16 to
check simultaneous checkout, repeated cancellation, stock compare-and-set,
receipt access and payment idempotency across reconnects. Live deployment and
same-commit restart evidence will be recorded separately.
