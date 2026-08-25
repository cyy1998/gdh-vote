import fs from "node:fs";
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { normalizeBasePath } from "./base-path.js";

export function mountClient(
  app: Hono,
  clientDirectory: string,
  configuredBasePath = "/",
) {
  if (!fs.existsSync(clientDirectory)) return;
  const basePath = normalizeBasePath(configuredBasePath);
  const route = basePath ? `${basePath}/*` : "/*";

  if (basePath) {
    app.get(basePath, (c) => c.redirect(`${basePath}/`));
  }
  app.use(
    route,
    serveStatic({
      root: clientDirectory,
      rewriteRequestPath: (requestPath) =>
        basePath ? requestPath.slice(basePath.length) || "/" : requestPath,
    }),
  );
  app.get(route, serveStatic({ root: clientDirectory, path: "index.html" }));
}
