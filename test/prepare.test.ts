import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

for (const fails of [false, true]) {
  test(`root prepare ${fails ? "propagates asset-build failure" : "builds assets before hook setup in production"}`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pi-prepare-"));
    try {
      for (const subdir of ["scripts", "packages/pi-inspect/scripts", ".husky"])
        mkdirSync(path.join(directory, subdir), { recursive: true });
      copyFileSync(path.resolve("scripts/prepare.mjs"), path.join(directory, "scripts/prepare.mjs"));
      writeFileSync(
        path.join(directory, "packages/pi-inspect/scripts/build.mjs"),
        `import { appendFileSync } from "node:fs";
appendFileSync("order.txt", "build\\n");
${fails ? 'throw new Error("asset build failed");' : ""}
`,
      );
      writeFileSync(
        path.join(directory, ".husky/install.mjs"),
        'import { appendFileSync } from "node:fs"; appendFileSync("order.txt", "hooks\\n");',
      );
      const result = spawnSync(process.execPath, ["scripts/prepare.mjs"], {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production" },
      });
      assert.equal(readFileSync(path.join(directory, "order.txt"), "utf8"), fails ? "build\n" : "build\nhooks\n");
      if (fails) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /asset build failed/u);
      } else assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
