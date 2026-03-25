import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const packageJson = JSON.parse(
  await fs.readFile(path.join(ROOT, "package.json"), "utf8"),
);
const scripts = packageJson.scripts ?? {};

const requiredScripts = ["build", "test", "lint", "format:check"];
for (const scriptName of requiredScripts) {
  if (!scripts[scriptName]) {
    throw new Error(`package.json is missing required script: ${scriptName}`);
  }
}

const agents = await fs.readFile(path.join(ROOT, "AGENTS.md"), "utf8");
const expectations = [
  { file: "AGENTS.md", needle: "npm run build" },
  { file: "AGENTS.md", needle: "npm run start" },
];

for (const expectation of expectations) {
  if (!agents.includes(expectation.needle)) {
    throw new Error(
      `${expectation.file} must document the command: ${expectation.needle}`,
    );
  }
}
