// Serves a built product directory to a Playwright context by fulfilling every
// same-origin request from disk. This exists because some confined sandboxes
// deny binding a listening socket; it changes only the transport, never the
// assertions or the bytes served.
import { readFile } from "node:fs/promises";
import path from "node:path";

// `localhost` is a potentially-trustworthy origin, so the product keeps
// `crypto.subtle` for its opaque canonical debug hash without a socket.
export const LOCAL_ORIGIN = "http://localhost:4173";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function installDistRoutes(context, distDir) {
  const root = path.resolve(distDir);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== LOCAL_ORIGIN) {
      await route.abort();
      return;
    }
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      await route.fulfill({ status: 404, body: "not found" });
      return;
    }
    try {
      const body = await readFile(file);
      await route.fulfill({
        status: 200,
        headers: { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" },
        body,
      });
    } catch {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
}
