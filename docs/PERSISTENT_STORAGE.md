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

The documented free Render integration environment has ephemeral storage.
Attaching persistent storage requires access to its hosting configuration and an
explicit choice of an available hosting plan. No plan or disk is purchased by
this code change. Successful/cancelled YooKassa sandbox checkout and return-to-store
still need to be tested against the actual test service. Real payment keys remain
prohibited and delivery remains outside the task.
