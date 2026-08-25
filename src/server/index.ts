import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { mountClient } from "./client-mount.js";
import { createTallyRepository } from "./repository.js";

const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) loadEnvFile(envFile);

const accessPassword = process.env.ACCESS_PASSWORD;
if (!accessPassword) {
  throw new Error("ACCESS_PASSWORD 未配置，服务拒绝启动");
}

const dataDirectory = path.resolve(process.env.DATA_DIR ?? "data");
fs.mkdirSync(dataDirectory, { recursive: true });
const repository = createTallyRepository(
  path.join(dataDirectory, "election-tallying.db"),
);
const app = createApp(repository, {
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  basePath: process.env.TALLY_BASE_PATH,
  accessCredentials: {
    username: process.env.ACCESS_USERNAME ?? "shrq",
    password: accessPassword,
  },
});
const clientDirectory = path.resolve("dist/client");
mountClient(app, clientDirectory, process.env.TALLY_BASE_PATH);
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) =>
  console.log(`计票助手已启动：http://localhost:${info.port}`),
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    repository.close();
    process.exit(0);
  });
