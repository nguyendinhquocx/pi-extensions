import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const staging = `${root}dist-staging`;
await rm(staging, { recursive: true, force: true });
try {
  await mkdir(staging, { recursive: true });
  await build({
    entryPoints: [`${root}src/web/app.tsx`],
    bundle: true,
    outfile: `${staging}/app.js`,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "eof",
  });
  await writeFile(
    `${staging}/index.html`,
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Session Inspector</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  );
  await rm(`${root}dist`, { recursive: true, force: true });
  await rename(staging, `${root}dist`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
