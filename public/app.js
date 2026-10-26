let products = [],
  catalog = [],
  cart = {},
  lastOrder,
  loadController,
  checkoutPending = false,
  previousFocus;
try {
  const stored = JSON.parse(localStorage.getItem("roastory-cart") || "{}");
  if (stored && typeof stored === "object" && !Array.isArray(stored))
    cart = Object.fromEntries(
      Object.entries(stored)
        .filter(
          ([id, q]) =>
            /^[1-9]\d*$/.test(id) &&
            Number.isSafeInteger(q) &&
            q >= 1 &&
            q <= 10,
        )
        .slice(0, 50),
    );
} catch {
  /* Keep the cart usable when browser storage is unavailable. */
}
const loadFeedback = document.createElement("p");
loadFeedback.setAttribute("role", "status");
document.querySelector("#products").before(loadFeedback);
const money = (v) => `${new Intl.NumberFormat("ru-RU").format(v)} ₽`;
async function load(process = "all") {
  loadController?.abort();
  const controller = (loadController = new AbortController());
  loadFeedback.textContent = "Загрузка кофе…";
  try {
    catalog = await fetch("/api/products", { signal: controller.signal }).then(
      (r) => {
        if (!r.ok) throw Error("Catalog unavailable");
        return r.json();
      },
    );
    if (controller.signal.aborted) return;
    cart = Object.fromEntries(
      Object.entries(cart).filter(([id]) =>
        catalog.some((p) => p.id === Number(id)),
      ),
    );
    products =
      process === "all"
        ? catalog
        : catalog.filter((p) => p.process === process);
    loadFeedback.textContent = "";
    document.querySelector("#products").innerHTML = products
      .map(
        (p) =>
          `<article class="product" style="--color:${p.color}"><div class="product-art"><img src="photos/coffee-${p.id}.webp" alt="Кофе ${p.name}" width="1440" height="960" loading="lazy" decoding="async"></div><div class="product-info"><div class="product-top"><h3>${p.name}</h3><span>★ ${p.score}</span></div><p>${p.origin} · ${p.process}</p><div class="notes">${p.notes}</div><div class="product-foot"><strong>${money(p.price)}</strong><button data-add="${p.id}">＋</button></div></div></article>`,
      )
      .join("");
    document.querySelectorAll("[data-add]").forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          if (checkoutPending) return;
          const id = Number(b.dataset.add);
          cart[id] = Math.min(10, (cart[id] || 0) + 1);
          save();
          openCart();
        }),
    );
    renderCart();
  } catch (error) {
    if (controller.signal.aborted) return;
    loadFeedback.textContent = "Не удалось загрузить кофе. ";
    const retry = document.createElement("button");
    retry.textContent = "Повторить загрузку";
    retry.onclick = () => load(process);
    loadFeedback.append(retry);
  }
}
function save() {
  try {
    localStorage.setItem("roastory-cart", JSON.stringify(cart));
  } catch {
    /* Retain the current session cart. */
  }
  renderCart();
}
function renderCart() {
  const entries = Object.entries(cart);
  document.querySelector("#cart-count").textContent = entries.reduce(
    (a, [, q]) => a + q,
    0,
  );
  const known = entries
    .map(([id, q]) => ({ p: catalog.find((x) => x.id === Number(id)), q }))
    .filter((x) => x.p);
  document.querySelector("#cart-items").innerHTML = known
    .map(
      ({ p, q }) =>
        `<div class="cart-item"><img src="photos/coffee-${p.id}.webp" alt="" width="50" height="55" loading="lazy"><span><b>${p.name}</b><small>${q} × ${money(p.price)}</small></span><button data-remove="${p.id}">×</button></div>`,
    )
    .join("");
  const total = known.reduce((a, { p, q }) => a + p.price * q, 0);
  document.querySelector("#cart-total").textContent = money(total);
  document
    .querySelector(".cart")
    .classList.toggle("has-items", known.length > 0);
  document.querySelectorAll("[data-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        if (checkoutPending) return;
        delete cart[b.dataset.remove];
        save();
      }),
  );
}
function openCart() {
  if (!document.querySelector(".cart").classList.contains("open"))
    previousFocus = document.activeElement;
  document.querySelector(".cart").inert = false;
  document.querySelector(".cart").classList.add("open");
  document.querySelector(".overlay").classList.add("open");
  document.querySelector("main").inert = true;
  document.querySelector("body>header").inert = true;
  document.querySelector(".cart-close").focus();
}
function closeCart() {
  document.querySelector(".cart").classList.remove("open");
  document.querySelector(".overlay").classList.remove("open");
  document.querySelector(".cart").inert = true;
  document.querySelector("main").inert = false;
  document.querySelector("body>header").inert = false;
  previousFocus?.focus();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector(".cart.open")) closeCart();
});
document.querySelector(".cart-button").onclick = openCart;
document.querySelector(".menu").onclick = openCart;
document.querySelector(".cart-close").onclick = closeCart;
document.querySelector(".overlay").onclick = closeCart;
document.querySelectorAll("[data-process]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-process]")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      load(b.dataset.process);
    }),
);
document.querySelector("#checkout").onsubmit = async (e) => {
  e.preventDefault();
  if (checkoutPending) return;
  checkoutPending = true;
  const button = e.target.querySelector("button");
  button.disabled = true;
  try {
    const d = new FormData(e.target);
    const items = Object.entries(cart).map(([productId, quantity]) => ({
      productId: Number(productId),
      quantity,
    }));
    const body = JSON.stringify({
      customer: d.get("customer"),
      email: d.get("email"),
      items,
    });
    if (lastOrder?.body !== body)
      lastOrder = { body, key: crypto.randomUUID() };
    const r = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": lastOrder.key,
      },
      body,
    });
    const o = await r.json();
    document.querySelector(".order-success").textContent = r.ok
      ? `Демо-заказ №${o.id} сохранён. Сумма ${money(o.total)}.`
      : o.message;
    if (r.ok) {
      cart = {};
      save();
      e.target.reset();
      lastOrder = null;
    }
  } catch {
    document.querySelector(".order-success").textContent =
      "Не удалось отправить заказ. Корзина и контакты сохранены; повторите отправку.";
  } finally {
    checkoutPending = false;
    button.disabled = false;
  }
};
load();
