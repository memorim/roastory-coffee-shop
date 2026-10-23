# Пример API

Ответ получен при локальном запуске проверяемой версии. Данные демонстрационные.

```http
GET /api/products/1 HTTP/1.1
Host: localhost:4500
```

HTTP 200

```json
{
  "id": 1,
  "name": "Kayon Mountain",
  "origin": "Эфиопия",
  "process": "Натуральная",
  "notes": "бергамот · черника · какао",
  "price": 1090,
  "score": 4.9,
  "color": "#d9653b",
  "available": 1
}
```
