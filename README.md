# Roastory — интернет-магазин кофе

Показывает каталог кофе и сценарий оформления заказа.

**Проект:** Самостоятельная разработка.

![CI](https://github.com/memorim/roastory-coffee-shop/actions/workflows/ci.yml/badge.svg)

![Компьютерная версия](docs/desktop.png)

<img src="docs/mobile.png" width="320" alt="Мобильная версия">

[Короткая демонстрация сценария](docs/demo.gif)

## Что работает
- Каталог и фильтры по обработке кофе.
- Корзина в localStorage, отправка и сохранение заказа.
- Серверный пересчёт суммы, транзакционная запись заказа и позиций.

## Стек
JavaScript, Express, SQLite, Zod, HTML, CSS.

## Запуск и проверка
Node.js 24.18.0 и pnpm 11.7.0.

```bash
npm install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

## Технические решения
- Стоимость заказа берётся из серверного каталога.
- Корзина хранит товары независимо от активного фильтра каталога.

## Подробности
[API, конфигурация и исходные инструкции](docs/TECHNICAL.md).

[Результаты проверки этой версии](docs/VERIFICATION.md).

[Пример запроса и ответа API](docs/API_EXAMPLE.md).

## Проверки и обновления
CI проверяет проект и ссылки на локальные материалы. Dependabot предлагает обновления зависимостей и Actions. [История изменений](CHANGELOG.md).

[Контракты API и обновление базы](docs/COMPATIBILITY.md): `pnpm test:contract && pnpm test:upgrade`.
