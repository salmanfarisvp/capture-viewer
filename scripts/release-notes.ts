/**
 * Generate release notes (Markdown) from the commits since the previous release tag.
 * Commits are grouped by Conventional Commit type; "- " bullet lines in a commit body
 * become sub-items, so a well-written commit message turns straight into notes.
 *
 *   bun scripts/release-notes.ts v26.11.0 > notes.md
 */
import { $ } from "bun";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: bun scripts/release-notes.ts <tag>");
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY ?? "";
const TAG_PATTERN = "v[0-9][0-9].*"; // only calendar-version tags (YY.M.N)
const prev = (await $`git describe --tags --abbrev=0 --match ${TAG_PATTERN} ${`${tag}^`}`.nothrow().quiet().text()).trim();
const range = prev ? `${prev}..${tag}` : tag;

const raw = await $`git log ${range} --no-merges --reverse --format=%h%x1f%s%x1f%b%x1e`.text();

const GROUPS: Array<[RegExp, string]> = [
  [/^feat$/, "Features"],
  [/^fix$/, "Fixes"],
  [/^perf$/, "Performance"],
  [/^docs$/, "Documentation"],
];
const OTHER = "Other changes";
const grouped = new Map<string, string[]>();

for (const entry of raw.split("\x1e")) {
  const [hash = "", subject = "", body = ""] = entry.trim().split("\x1f");
  if (!subject || /^chore: release\b/.test(subject)) continue;

  const m = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject);
  const type = m?.[1] ?? "";
  const title = m?.[2] ?? subject;
  const heading = GROUPS.find(([re]) => re.test(type))?.[1] ?? OTHER;

  const link = repo ? `[${hash}](https://github.com/${repo}/commit/${hash})` : hash;
  const lines = [`- ${title.charAt(0).toUpperCase()}${title.slice(1)} (${link})`];
  for (const line of body.split("\n")) {
    if (/^\s*[-*] /.test(line)) lines.push(`  - ${line.replace(/^\s*[-*] /, "").trim()}`);
  }
  grouped.set(heading, [...(grouped.get(heading) ?? []), ...lines]);
}

const out: string[] = [];
if (!prev) out.push("First release.", "");
for (const heading of [...GROUPS.map(([, h]) => h), OTHER]) {
  const items = grouped.get(heading);
  if (items?.length) out.push(`## ${heading}`, "", ...items, "");
}
if (!grouped.size) out.push("No changes since the previous release.", "");

if (repo) {
  const [owner, name] = repo.split("/");
  out.push("## Get it", "");
  out.push(`- Use it in the browser: https://${owner}.github.io/${name}/`);
  out.push(`- Self-host: download \`capture-viewer-${tag}.zip\` below and serve it over https:// or http://localhost`);
  out.push("");
  if (prev) out.push(`**Full changelog**: https://github.com/${repo}/compare/${prev}...${tag}`);
}

console.log(out.join("\n").trimEnd());
