// Browser-only adapter, loaded exclusively by scripts/build_demo.py.
// ponytail: state lasts for one page session; use the documented server for shared, durable data.
(() => {
  const state = structuredClone(globalThis.DEMO_SEED);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const text = (value, min = 1, max = 200) => {
    if (
      typeof value !== "string" ||
      value.trim().length < min ||
      value.trim().length > max
    )
      fail("Проверьте введённые данные");
    return value.trim();
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, globalThis.location.href);
    if (
      url.origin !== globalThis.location.origin ||
      !url.pathname.startsWith("/api/")
    )
      return originalFetch(input, options);
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    try {
      return await handle(
        url,
        options.method || "GET",
        options.body ? JSON.parse(options.body) : {},
        new Headers(options.headers),
      );
    } catch (error) {
      return json(
        { message: error.message, detail: error.message },
        error.status || 400,
      );
    }
  };
  globalThis.PORTFOLIO_DEMO = true;

  let order = 0;
  const seen = new Map();
  async function handle(url, method, body, headers) {
    if (url.pathname === "/api/products" && method === "GET")
      return json(state["/api/products"]);
    if (url.pathname === "/api/orders" && method === "POST") {
      text(body.customer, 2, 80);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email || ""))
        fail("Проверьте email");
      if (
        !Array.isArray(body.items) ||
        body.items.length < 1 ||
        body.items.length > 50 ||
        new Set(body.items.map((x) => x.productId)).size !== body.items.length
      )
        fail("Проверьте корзину");
      let total = 0;
      for (const item of body.items) {
        const product = state["/api/products"].find(
          (x) => x.id === item.productId && x.available,
        );
        if (
          !product ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 10
        )
          fail("Проверьте товары и количество");
        total += product.price * item.quantity;
      }
      const key = headers.get("Idempotency-Key"),
        serialized = JSON.stringify(body);
      if (key && seen.has(key)) {
        const previous = seen.get(key);
        if (previous.body !== serialized)
          fail("Запрос с этим ключом уже обработан", 409);
        return json(previous.result);
      }
      if (order >= 20) fail("Перезагрузите страницу для новой сессии", 429);
      const result = { id: ++order, total, status: "saved_locally" };
      if (key) seen.set(key, { body: serialized, result });
      return json(result, 201);
    }
    fail("Маршрут недоступен в браузерной версии", 404);
  }
})();
