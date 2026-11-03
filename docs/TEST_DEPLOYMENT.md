# Test deployment verification — 2026-11-03

Test service: https://memorim-roastory-test.onrender.com/

- Render Node 24.18.0, free instance; initial deployment succeeded.
- YooKassa test shop 1518621 is configured through Render environment variables. No secrets are stored in this repository.
- Browser scenario created order 1 for one Kayon Mountain package (1090 RUB), reopened its receipt, requested a test payment and refreshed its status through the server.
- Provider status was `pending`. The redirect to the YooMoney checkout failed in the connected browser with `ERR_CONNECTION_CLOSED`. Successful payment, cancellation and return-to-store flows are not yet verified end to end.
- This free instance uses ephemeral SQLite storage. It is a disposable integration environment, not durable production hosting. Redeployment can reset orders, stock and payment references. Do not use real customer contacts or real payments.
- Delivery integration is intentionally excluded by the owner.
