# Persistent Render test deployment plan — 2026-11-07

Target: existing `memorim-roastory-test` in Frankfurt. The proposal in
[deploy/render-persistent.yaml](../deploy/render-persistent.yaml) adopts that
service, upgrades compute from Free to 0.5c-512mb and attaches a 1 GB disk at
/var/lib/roastory. ROASTORY_DATA_DIRECTORY points to that mount. Existing build
and start commands, main source branch and test-store credentials are preserved.
The plan is prepared for review only; it is not applied by committing this file.

Current published prices: $7/month compute plus $0.25/month for 1 GB of disk,
approximately $7.25/month before possible taxes and usage charges. A disk cannot
be attached to Free compute. Provider: https://render.com/pricing and
https://render.com/docs/disks.

The current service is explicitly a disposable test environment. Before applying,
export any test records that must be kept from the current ephemeral instance;
Render does not migrate its old root filesystem onto the new disk automatically.
Do not promise to preserve old orders by changing only the environment path.
If old fixtures are intentionally discarded, the new persistent disk begins with
a fresh catalog and test orders. No real orders or payments should be introduced.

After approval and disk attachment: create a synthetic order and test payment,
record their IDs, restart/redeploy once and verify the same receipt, stock and
payment reference remain. Also rehearse restoration from a consistent copy.
Disk snapshots do not replace an application-level restore check.
