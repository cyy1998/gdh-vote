export function normalizeBasePath(value?: string) {
  const path = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return path ? `/${path}` : "";
}
