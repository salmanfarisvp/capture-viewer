/** Serve the production build from dist/ on http://localhost:4173 (localhost counts as a secure context). */
import { join, normalize } from "node:path";

const root = join(import.meta.dir, "..", "dist");
const port = Number(process.env.PORT ?? 4173);

Bun.serve({
  port,
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = Bun.file(join(root, path.endsWith("/") ? `${path}index.html` : path));
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(root, "index.html")));
  },
});

console.log(`Previewing dist/ at http://localhost:${port}`);
