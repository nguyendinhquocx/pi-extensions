import { fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI): void {
  pi.registerProvider(fauxProvider({ tokensPerSecond: Infinity }).provider);
  pi.registerCommand("inspector-smoke-reload", {
    description: "Reload runtime for the non-interactive inspector smoke",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
}
