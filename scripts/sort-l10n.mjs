/**
 * Sort every l10n bundle by key so all locales stay in the same order.
 * Run after adding, removing, or editing translations: `pnpm l10n:sort`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const l10nDir = join(dirname(fileURLToPath(import.meta.url)), "..", "l10n");
const files = (await readdir(l10nDir)).filter((f) => f.endsWith(".json")).sort();

for (const file of files) {
  const path = join(l10nDir, file);
  const bundle = JSON.parse(await readFile(path, "utf8"));
  const sorted = Object.fromEntries(
    Object.keys(bundle)
      .sort()
      .map((key) => [key, bundle[key]]),
  );
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`sorted ${Object.keys(sorted).length} keys -> l10n/${file}`);
}

console.log(`done (${files.length} file(s))`);
