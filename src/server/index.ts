import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { createTallyRepository } from "./repository.js";

const dataDirectory = path.resolve(process.env.DATA_DIR ?? "data");
fs.mkdirSync(dataDirectory, { recursive: true });
const repository = createTallyRepository(
  path.join(dataDirectory, "election-tallying.db"),
);
const app = createApp(repository, {
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
});
const clientDirectory = path.resolve("dist/client");
if (fs.existsSync(clientDirectory)) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
}
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) =>
  console.log(`计票助手已启动：http://localhost:${info.port}`),
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    repository.close();
    process.exit(0);
  });
