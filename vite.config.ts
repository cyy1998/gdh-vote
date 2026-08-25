import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function normalizeBasePath(value?: string) {
  const path = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return path ? `/${path}/` : "/";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "TALLY_");
  const base = normalizeBasePath(env.TALLY_BASE_PATH);
  const mountedPrefix = base === "/" ? "" : base.slice(0, -1);
  const apiPrefix = `${base}api`;
  const apiProxy = { target: "http://localhost:3000", changeOrigin: true };

  return {
    base,
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      proxy: {
        "/api": apiProxy,
        ...(mountedPrefix ? { [apiPrefix]: apiProxy } : {}),
      },
    },
    build: { outDir: "dist/client" },
  };
});
