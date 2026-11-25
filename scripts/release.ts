/**
 * Calendar versioning: YY.M.N (e.g. 26.11.0, 26.11.1, 26.12.0).
 *   YY = two-digit year, M = month (no leading zero, so it stays valid semver),
 *   N  = release number within that month, starting at 0.
 *
 * Bumps package.json, commits and creates an annotated tag. Pushing the tag triggers the
 * GitHub "Release" workflow, which builds and publishes a GitHub Release with generated notes.
 *
 *   bun run release            # next version for the current month
 *   bun run release 26.11.3    # explicit
 *
 * Then: git push origin main vYY.M.N
 */
import { $ } from "bun";

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = (await Bun.file(pkgPath).json()) as { version: string } & Record<string, unknown>;

function nextVersion(current: string, now = new Date()): string {
  const yy = now.getFullYear() % 100;
  const m = now.getMonth() + 1;
  const [cy, cm, cn] = current.split(/[.-]/).map(Number);
  return cy === yy && cm === m && Number.isFinite(cn) ? `${yy}.${m}.${(cn ?? 0) + 1}` : `${yy}.${m}.0`;
}

const arg = process.argv[2];
let next: string;
if (!arg) next = nextVersion(pkg.version);
else if (/^\d{2}\.(?:[1-9]|1[0-2])\.\d+(-[\w.]+)?$/.test(arg)) next = arg;
else {
  console.error(`Invalid version "${arg}". Use YY.M.N, e.g. 26.11.0 (or no argument for the next one).`);
  process.exit(1);
}

const dirty = (await $`git status --porcelain`.text()).trim();
if (dirty) {
  console.error("Working tree is not clean. Commit or stash changes first.");
  process.exit(1);
}

const tag = `v${next}`;
if ((await $`git tag --list ${tag}`.text()).trim()) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

// Make sure it builds before tagging.
await $`bun run check`;

pkg.version = next;
await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
await $`git add package.json`;
await $`git commit -m ${`chore: release ${tag}`}`;
await $`git tag -a ${tag} -m ${`Release ${tag}`}`;

console.log(`\nTagged ${tag}. Push it to publish the GitHub Release:\n\n  git push origin main ${tag}\n`);
