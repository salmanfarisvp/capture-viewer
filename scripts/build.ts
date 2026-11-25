/**
 * Production build: bundles src/index.html (+ TS + CSS) into dist/ with relative asset
 * paths, so the output works at a domain root or a sub-path (GitHub Pages).
 *
 * Version shown in the app: APP_VERSION env (set by the release workflow from the git tag),
 * otherwise package.json version.
 */
import { rm } from "node:fs/promises";
import pkg from "../package.json";

const outdir = "dist";
const version = (process.env.APP_VERSION ?? pkg.version).replace(/^v/, "");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir,
  minify: true,
  sourcemap: "linked",
  target: "browser",
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// GitHub Pages: skip Jekyll processing.
await Bun.write(`${outdir}/.nojekyll`, "");

for (const out of result.outputs) {
  const kb = (out.size / 1024).toFixed(1);
  console.log(`  ${out.path.replace(`${process.cwd()}/`, "")}  ${kb} KB`);
}
console.log(`Built capture-viewer v${version} -> ${outdir}/`);
