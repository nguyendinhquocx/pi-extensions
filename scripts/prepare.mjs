// Pi Git installs omit devDependencies and load source entrypoints without packing.
// Build the Inspector assets before the existing optional development hook setup.
await import("../packages/pi-inspect/scripts/build.mjs");
await import("../.husky/install.mjs");
