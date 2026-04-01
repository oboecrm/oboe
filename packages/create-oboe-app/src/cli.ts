#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const targetName = process.argv[2];

  if (!targetName) {
    console.error("Usage: create-oboe-app <directory>");
    process.exitCode = 1;
    return;
  }

  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(currentFile), "..");
  const templateRoot = path.resolve(packageRoot, "../../templates/starter");
  const targetRoot = path.resolve(process.cwd(), targetName);

  await mkdir(targetRoot, { recursive: true });
  await cp(templateRoot, targetRoot, { recursive: true });

  const packageJsonPath = path.join(targetRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name: string;
  };
  packageJson.name = targetName;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(`Scaffolded ${targetName} from templates/starter`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
