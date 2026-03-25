import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGETS = ["src", "web/src", "test", ".github", "scripts"];
const PATTERN = /\b(TODO|FIXME)\b/i;
const EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".yml",
  ".yaml",
]);

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

const offenders = [];
for (const target of TARGETS) {
  const fullTarget = path.join(ROOT, target);
  try {
    const files = await collectFiles(fullTarget);
    for (const file of files) {
      if (file.endsWith(path.join("scripts", "check-tech-debt.mjs"))) continue;
      const content = await fs.readFile(file, "utf8");
      if (PATTERN.test(content)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
  } catch {
    // optional target
  }
}

if (offenders.length) {
  console.error("Found TODO/FIXME markers in:");
  for (const offender of offenders) {
    console.error(`- ${offender}`);
  }
  process.exit(1);
}
