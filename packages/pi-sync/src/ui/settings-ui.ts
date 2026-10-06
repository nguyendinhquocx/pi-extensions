import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@narumitw/pi-tui-kit";
import { loadConfig } from "../settings/config.js";
import { localConfigPath } from "../settings/config-file.js";
import { updateSyncSetup } from "../settings/settings-management.js";
import { updateLocalConfig } from "../settings/settings-store.js";
import { normalizeLocalFields, sameLocalFields } from "../sync/local-fields.js";
import {
  SETUP_SWITCH_ACTION_OPTIONS,
  saveOnSwitch,
  setupSwitchActionFromLabel,
  setupSwitchActionLabel,
} from "../sync/setup-switch.js";
import { captureMutationOwner } from "../sync/sync-local.js";
import type { RunRoute } from "./cancellable-operation.js";
import { dispatchManagerResult } from "./manager-result-dispatcher.js";
import { AUTOMATIC_SYNC_DESCRIPTION } from "./setup/setup-prompts.js";
import { configureSyncStatus } from "./sync-status.js";
import { safeTerminalText } from "./terminal-text.js";

export type SyncSettingsRoute = RunRoute;

export async function showSyncSettings(
  ctx: ExtensionCommandContext,
  runRoute: SyncSettingsRoute,
  signal?: AbortSignal,
) {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`Edit pi-sync settings manually: ${safeTerminalText(localConfigPath())}`, "info");
    return;
  }
  const initial = await loadConfig();
  if (signal?.aborted) return;
  const setupName = initial.setupName;
  type Action =
    | "automatic"
    | "automatic-transfer"
    | "merge-settings"
    | "local-fields"
    | "content-policy"
    | "skip-secret-scan"
    | "show-status"
    | "on-switch"
    | "include"
    | "remote-include";
  const menu = defineMenu<Awaited<ReturnType<typeof loadConfig>>, "settings", Action, ExtensionCommandContext>({
    start: "settings",
    screens: {
      settings: ({ state }) => ({
        kind: "settings",
        title: "Pi Sync Settings",
        lines: [
          `Sync setup: ${safeTerminalText(state.setupName)} · Storage connection: ${safeTerminalText(state.connectionName)}`,
        ],
        items: [
          {
            id: "automatic",
            label: "Automatic sync",
            description: AUTOMATIC_SYNC_DESCRIPTION,
            currentValue: state.automatic ? "On" : "Off",
            values: ["On", "Off"],
            action: "automatic",
          },
          {
            id: "skipSecretScan",
            label: "Skip secret scan (all setups)",
            description: "All setups: allow pushes without checking managed local files for possible secrets.",
            currentValue: state.skipSecretScan ? "On" : "Off",
            values: ["On", "Off"],
            action: "skip-secret-scan",
          },
          {
            id: "showStatus",
            label: "Show status (all setups)",
            description: "All setups: show sync progress and attention in Pi status.",
            currentValue: state.showStatus ? "On" : "Off",
            values: ["On", "Off"],
            action: "show-status",
          },
          {
            id: "onSwitch",
            label: "After switching setup (all setups)",
            description: "All setups: ask before a pull review, open it automatically, or switch without pulling.",
            currentValue: setupSwitchActionLabel(state.onSwitch),
            values: SETUP_SWITCH_ACTION_OPTIONS.map(({ label }) => label),
            action: "on-switch",
          },
          {
            id: "include",
            label: "Included content",
            description: `${state.include.length} selected path${state.include.length === 1 ? "" : "s"}. Choose which paths this setup syncs.`,
            currentValue: "Open editor",
            action: "include",
          },
          {
            id: "remoteInclude",
            label: "Compare synced content",
            description: "Review this device and remote content lists before choosing either one.",
            currentValue: "Review",
            action: "remote-include",
          },
          {
            id: "automaticTransfer",
            label: "Automatic transfer at startup",
            description:
              "May upload, replace, or delete selected files once at idle startup in TUI/RPC. Requires a baseline and conditional/lease publication; never reloads resources. Turning off cancels pending work.",
            currentValue: state.automaticTransfer ? "On" : "Off",
            values: ["On", "Off"],
            action: "automatic-transfer",
          },
          {
            id: "mergeSettings",
            label: "Settings field merge (experimental)",
            description:
              "Combine independent global settings.json fields using a verified private ancestor; arrays and nested objects remain atomic. No reload.",
            currentValue: state.mergeSettings ? "On" : "Off",
            values: ["On", "Off"],
            action: "merge-settings",
          },
          {
            id: "localFields",
            label: "Machine-local settings fields",
            description:
              "Root field names omitted from future portable snapshots. Policy changes require directional migration; old history remains.",
            currentValue: `${state.localFields?.length ?? 0} fields · Edit`,
            action: "local-fields",
          },
          {
            id: "contentPolicy",
            label: "Content / partial sync (experimental)",
            description:
              "Version-5 opt-in: bounded text and prefix-only sessions; partial progress keeps full withheld versions and old baseline hashes.",
            currentValue: state.mergeContent
              ? state.partialSync
                ? "Content & partial"
                : "Content only"
              : state.partialSync
                ? "Partial only"
                : "Off",
            values: ["Off", "Content only", "Content & partial", "Partial only"],
            action: "content-policy",
          },
        ],
      }),
    },
    actions: {
      "content-policy": async ({ value, signal: actionSignal }) => {
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        const validate = captureMutationOwner(ctx, mutationSignal);
        try {
          const previous = await loadConfig(setupName);
          validate();
          const mergeContent = value === "Content only" || value === "Content & partial";
          const partialSync = value === "Partial only" || value === "Content & partial";
          if (
            !(await ctx.ui.confirm(
              "Save experimental content policy?",
              "This explicitly upgrades settings to version 5; partial snapshots use version 3 and older clients must refuse them. Text/session merge is conservative. Partial sync preserves withheld versions and old baselines. Disabling does not clear unresolved groups or recovery evidence. Review a directional migration first if portable policy changes.",
              { signal: mutationSignal },
            ))
          )
            return { kind: "rejected" };
          validate();
          await updateLocalConfig((current) => {
            validate();
            const setup = current.syncSetups[setupName];
            if (
              !setup ||
              Boolean(setup.sync.mergeContent) !== Boolean(previous.mergeContent) ||
              Boolean(setup.sync.partialSync) !== Boolean(previous.partialSync)
            )
              throw new Error("Content policy changed during review.");
            return {
              ...current,
              version: 5,
              syncSetups: {
                ...current.syncSetups,
                [setupName]: { ...setup, sync: { ...setup.sync, mergeContent, partialSync } },
              },
            };
          }, mutationSignal);
          validate();
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      "merge-settings": async ({ value, signal: actionSignal }) => {
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        const validate = captureMutationOwner(ctx, mutationSignal);
        try {
          validate();
          await updateSyncSetup(
            setupName,
            (setup) => ({ ...setup, sync: { ...setup.sync, mergeSettings: value === "On" } }),
            { signal: mutationSignal },
          );
          validate();
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      "local-fields": async ({ signal: actionSignal }) => {
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        const validate = captureMutationOwner(ctx, mutationSignal);
        try {
          const previous = await loadConfig(setupName);
          validate();
          const input = await ctx.ui.input(
            "Machine-local settings.json root fields (JSON string array)",
            JSON.stringify(previous.localFields ?? []),
            { signal: mutationSignal },
          );
          validate();
          if (input === undefined) return { kind: "rejected" };
          let fields: string[];
          try {
            fields = normalizeLocalFields(JSON.parse(input));
          } catch {
            throw new Error("Invalid localFields JSON array; no policy was changed.");
          }
          if (sameLocalFields(previous.localFields, fields)) return { kind: "stay" };
          const confirmed = await ctx.ui.confirm(
            "Save portable field policy?",
            "This opts into settings/snapshot version 4/2; older clients must refuse them. Future snapshots omit these fields, but old remote history is NOT erased. Review an explicit force push/pull migration before further sync. Removed rules can expose or replace local-only values.",
            { signal: mutationSignal },
          );
          validate();
          if (!confirmed) return { kind: "rejected" };
          await updateLocalConfig((current) => {
            validate();
            const setup = current.syncSetups[setupName];
            if (!setup || !sameLocalFields(setup.sync.localFields, previous.localFields))
              throw new Error("Field policy changed while under review; reopen settings.");
            return {
              ...current,
              version: current.version === 5 ? 5 : 4,
              syncSetups: {
                ...current.syncSetups,
                [setupName]: { ...setup, sync: { ...setup.sync, localFields: fields } },
              },
            };
          }, mutationSignal);
          validate();
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      automatic: async ({ value, signal: actionSignal }) => {
        const automatic = value === "On";
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        try {
          const latest = await loadConfig(setupName);
          if (mutationSignal.aborted) return { kind: "rejected" };
          if (latest.automatic === automatic) return { kind: "stay" };
          await updateSyncSetup(setupName, (setup) => ({ ...setup, sync: { ...setup.sync, automatic } }), {
            signal: mutationSignal,
          });
          if (mutationSignal.aborted) return { kind: "rejected" };
          ctx.ui.notify(
            `Automatic sync ${automatic ? "enabled" : "disabled"} for “${safeTerminalText(setupName)}”.`,
            "info",
          );
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      "automatic-transfer": async ({ value, signal: actionSignal }) => {
        const automaticTransfer = value === "On";
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        try {
          await updateSyncSetup(setupName, (setup) => ({ ...setup, sync: { ...setup.sync, automaticTransfer } }), {
            signal: mutationSignal,
          });
          if (mutationSignal.aborted) return { kind: "rejected" };
          ctx.ui.notify(
            `Automatic startup transfer ${automaticTransfer ? "enabled for the next session start" : "disabled"}. Completed transfers are not undone.`,
            "info",
          );
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      "skip-secret-scan": async ({ value, signal: actionSignal }) => {
        const skipSecretScan = value === "On";
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        try {
          const latest = await loadConfig(setupName);
          if (mutationSignal.aborted) return { kind: "rejected" };
          if (latest.skipSecretScan === skipSecretScan) return { kind: "stay" };
          await updateLocalConfig((settings) => ({ ...settings, skipSecretScan }), mutationSignal);
          if (mutationSignal.aborted) return { kind: "rejected" };
          ctx.ui.notify(`Secret scan ${skipSecretScan ? "disabled" : "enabled"} for pushes in all setups.`, "info");
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      "show-status": async ({ value, signal: actionSignal }) => {
        const showStatus = value === "On";
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        try {
          const latest = await loadConfig(setupName);
          if (mutationSignal.aborted) return { kind: "rejected" };
          if (latest.showStatus === showStatus) return { kind: "stay" };
          await updateLocalConfig((settings) => ({ ...settings, showStatus }), mutationSignal);
          if (mutationSignal.aborted) return { kind: "rejected" };
          configureSyncStatus(ctx, showStatus);
          ctx.ui.notify(`Pi Sync status ${showStatus ? "enabled" : "disabled"} for all setups.`, "info");
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      "on-switch": async ({ value, signal: actionSignal }) => {
        const action = value ? setupSwitchActionFromLabel(value) : undefined;
        if (!action) return { kind: "rejected" };
        const mutationSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        try {
          const latest = await loadConfig(setupName);
          if (mutationSignal.aborted) return { kind: "rejected" };
          if (latest.onSwitch === action) return { kind: "stay" };
          await saveOnSwitch(action, mutationSignal);
          if (mutationSignal.aborted) return { kind: "rejected" };
          ctx.ui.notify(`After switching setup: ${value}.`, "info");
          return { kind: "stay" };
        } catch (error) {
          if (!mutationSignal.aborted) notifySaveFailure(ctx, error);
          return { kind: "rejected" };
        }
      },
      include: async ({ signal: actionSignal }) => {
        const editorSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        await runRoute("files", editorSignal, undefined, setupName);
        return editorSignal.aborted ? { kind: "rejected" } : { kind: "stay" };
      },
      "remote-include": async ({ signal: actionSignal }) => {
        const reviewSignal = signal ? AbortSignal.any([signal, actionSignal]) : actionSignal;
        const { showRemoteSelectionReview } = await import("./remote-selection-ui.js");
        if (reviewSignal.aborted) return { kind: "rejected" };
        const review = await showRemoteSelectionReview(ctx, setupName, reviewSignal, undefined, {
          origin: "settings",
          runRoute,
        });
        if (reviewSignal.aborted) return { kind: "rejected" };
        if (review.kind === "route-result") {
          const disposition = await dispatchManagerResult(ctx, review.result, review.route, runRoute, reviewSignal);
          return disposition.kind === "close" ? { kind: "close" } : { kind: "stay" };
        }
        return review.kind === "closed" || review.kind === "stale" ? { kind: "close" } : { kind: "stay" };
      },
    },
  });
  await runMenu(ctx, menu, {
    getState: () => loadConfig(setupName),
    signal,
    isCurrent: () => !signal?.aborted,
  });
}

function notifySaveFailure(ctx: ExtensionCommandContext, error: unknown) {
  ctx.ui.notify(
    `Pi Sync settings save failed: ${safeTerminalText(error instanceof Error ? error.message : String(error))}`,
    "error",
  );
}
