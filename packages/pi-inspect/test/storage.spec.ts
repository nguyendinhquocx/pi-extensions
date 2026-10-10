import { expect, test } from "@playwright/test";
import { Collector } from "../src/collector.js";
import { branch, detail, snapshot } from "../src/projection.js";
import { startServer, type ViewerServer } from "../src/server.js";
import { fixture, skills, tools } from "./fixtures.js";

let server: ViewerServer;
test.beforeEach(async () => {
  const data = fixture();
  const collector = new Collector();
  server = await startServer({
    generation: "storage-fixture",
    signal: new AbortController().signal,
    snapshot: () => snapshot(data.manager, collector, "storage-fixture", 0, "prompt", tools, ["read"], skills),
    branch: (leaf, offset) => branch(data.manager, leaf, offset, skills),
    detail: (id, leaf) => detail(data.manager, id, leaf, collector),
  });
});
test.afterEach(async () => {
  await server.close();
});

for (const failure of ["getter", "read", "write"] as const) {
  for (const link of ["compact", "legacy", "fragment-free"] as const) {
    test(`${failure} storage failure: ${link} link mounts without leaking credentials`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((failure) => {
        const denied = () => {
          throw new DOMException("Storage blocked", "SecurityError");
        };
        if (failure === "getter") Object.defineProperty(window, "sessionStorage", { get: denied });
        else Object.defineProperty(Storage.prototype, failure === "read" ? "getItem" : "setItem", { value: denied });
      }, failure);
      const url =
        link === "compact"
          ? server.url
          : link === "legacy"
            ? `${server.origin}/#token=${server.token}&generation=storage-fixture`
            : server.origin;
      await page.goto(url);
      if (link === "fragment-free") {
        await expect(page.getByText("Session expired or unauthorized; open the viewer again from Pi.")).toBeVisible();
      } else {
        await expect(page.locator(".segment-row").first()).toBeVisible();
        if (failure === "write") {
          await page.reload();
          await expect(page.getByText("Session expired or unauthorized; open the viewer again from Pi.")).toBeVisible();
        }
      }
      expect(new URL(page.url()).hash).toBe("");
      expect(errors).toEqual([]);
      await expect(page.locator("body")).not.toContainText(server.token);
    });
  }
}
