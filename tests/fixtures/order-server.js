import { createApp, createDb } from "../../server.js";
const db = createDb(process.argv[2]);
const server = createApp(db).listen(0, "127.0.0.1", () =>
  process.send({ port: server.address().port }),
);
process.on("message", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
