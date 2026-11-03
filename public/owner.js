const $ = (id) => document.getElementById(id);
let ownerKey = "";
const message = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text ?? "");
  return node;
};
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + ownerKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.message || "Не удалось выполнить запрос: " + response.status,
    );
  }
  return response.status === 204 ? null : response.json();
}
function table(container, headings, rows) {
  const wrap = el("div");
  wrap.className = "scroll";
  const t = el("table"),
    thead = el("thead"),
    tr = el("tr");
  headings.forEach((h) => tr.append(el("th", h)));
  thead.append(tr);
  t.append(thead);
  const body = el("tbody");
  for (const cells of rows) {
    const row = el("tr");
    for (const item of cells) {
      const cell = el("td");
      item instanceof Node
        ? cell.append(item)
        : (cell.textContent = String(item ?? "—"));
      row.append(cell);
    }
    body.append(row);
  }
  t.append(body);
  wrap.append(t);
  container.replaceChildren(wrap);
  if (!rows.length) container.append(el("p", "Пока нет записей."));
}
function action(text, run) {
  const button = el("button", text);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  ownerKey = $("owner-key").value.trim();
  $("owner-key").value = "";
  try {
    await load();
    $("workspace").hidden = false;
    $("login").hidden = true;
    $("logout").hidden = false;
    message("Данные обновлены.");
  } catch (error) {
    ownerKey = "";
    message(error.message, true);
  }
});
$("logout").addEventListener("click", () => {
  ownerKey = "";
  location.reload();
});
$("refresh").addEventListener("click", async () => {
  try {
    await load();
    message("Данные обновлены.");
  } catch (error) {
    message(error.message, true);
  }
});
async function load() {
  const orders = await api("/api/owner/orders");
  const products = await api("/api/products");
  table(
    $("orders"),
    ["Заказ", "Покупатель", "Контакт", "Сумма, ₽", "Статус"],
    orders.map((o) => [o.id, o.customer, o.email, o.total, o.status]),
  );
  table(
    $("products"),
    ["Товар", "Текущий остаток", "Новый остаток", "Действие"],
    products.map((p) => {
      const input = el("input");
      input.type = "number";
      input.min = "0";
      input.max = "1000000";
      input.step = "1";
      input.value = p.stock ?? "";
      input.setAttribute("aria-label", "Остаток: " + p.name);
      return [
        p.name,
        p.stock ?? "Без учёта",
        input,
        action("Сохранить", async () => {
          if (!input.value || !input.checkValidity())
            throw new Error("Укажите целый остаток от 0 до 1 000 000");
          await api("/api/owner/products/" + p.id + "/stock", {
            method: "PATCH",
            body: JSON.stringify({
              stock: Number(input.value),
              expectedStock: p.stock,
            }),
          });
          await load();
          message("Остаток сохранён.");
        }),
      ];
    }),
  );
}
