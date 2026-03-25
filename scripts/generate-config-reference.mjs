import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "src", "config.ts");
const outputPath = path.join(root, "docs", "generated", "config-reference.md");
const checkOnly = process.argv.includes("--check");

const source = await fs.readFile(sourcePath, "utf8");
const names = Array.from(source.matchAll(/^export const ([A-Z0-9_]+)/gm)).map(
  (match) => match[1],
);

const markdown = `# Generated config reference

This file is generated from \`src/config.ts\`.

## Exported configuration keys

${names.map((name) => `- \`${name}\``).join("\n")}
`;

if (checkOnly) {
  const existing = await fs.readFile(outputPath, "utf8");
  if (existing !== markdown) {
    throw new Error(
      "Generated config reference is out of date. Run `npm run docs:generate`.",
    );
  }
  process.exit(0);
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, markdown);
