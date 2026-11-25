/**
 * Bump the version, commit and create a git tag. Pushing the tag triggers the
 * GitHub "Release" workflow, which builds and publishes a GitHub Release.
 *
 *   bun run release patch    # 0.1.0 -> 0.1.1
 *   bun run release minor    # 0.1.0 -> 0.2.0
 *   bun run release major    # 0.1.0 -> 1.0.0
 *   bun run release 1.4.0    # explicit
 *
 * Then: git push --follow-tags
 */
import { $ } from "bun";

const arg = process.argv[2] ?? "patch";
const pkgPath = new URL("../package.json", import.meta.url);
const pkg = (await Bun.file(pkgPath).json()) as { version: string } & Record<string, unknown>;

const dirty = (await $`git status --porcelain`.text()).trim();
if (dirty) {
  console.error("Working tree is not clean. Commit or stash changes first.");
  process.exit(1);
}

const [maj = 0, min = 0, pat = 0] = pkg.version.split(".").map(Number);
let next: string;
if (arg === "patch") next = `${maj}.${min}.${pat + 1}`;
else if (arg === "minor") next = `${maj}.${min + 1}.0`;
else if (arg === "major") next = `${maj + 1}.0.0`;
else if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) next = arg;
else {
  console.error(`Unknown version argument "${arg}". Use patch | minor | major | x.y.z`);
  process.exit(1);
}

const tag = `v${next}`;
const existing = (await $`git tag --list ${tag}`.text()).trim();
if (existing) {
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

console.log(`\nTagged ${tag}. Push it to publish the GitHub Release:\n\n  git push --follow-tags\n`);
