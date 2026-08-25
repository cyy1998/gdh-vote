import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mountClient } from "./client-mount.js";

let clientDirectory: string | undefined;

afterEach(() => {
  if (clientDirectory) fs.rmSync(clientDirectory, { recursive: true });
  clientDirectory = undefined;
});

describe("client mounting", () => {
  it("serves JavaScript from the configured subpath", async () => {
    clientDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tally-client-"));
    fs.mkdirSync(path.join(clientDirectory, "assets"));
    fs.writeFileSync(
      path.join(clientDirectory, "index.html"),
      '<script type="module" src="/gdh-vote/assets/app.js"></script>',
    );
    fs.writeFileSync(path.join(clientDirectory, "assets/app.js"), "export {};");

    const app = new Hono();
    mountClient(app, clientDirectory, "/gdh-vote/");

    const response = await app.request("/gdh-vote/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe("export {};");
  });
});
