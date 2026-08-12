{ pkgs }:
# Raw Playwright scripting runner. `pkgs` MUST come from the `nixpkgs-playwright`
# input (nixos-25.05): its `playwright-test` node module and
# `playwright-driver.browsers` are a MATCHED pair, so no slot-shim is needed.
let
  playwrightModule = "${pkgs.playwright-test}/lib/node_modules/playwright/index.js";
  browsers = pkgs.playwright-driver.browsers;
in
pkgs.writeShellScriptBin "playwright-run" ''
  # Usage: playwright-run script.mjs [args...]
  # In the script (ESM ignores NODE_PATH, so import via the env var):
  #   const pw = await import(process.env.PLAYWRIGHT);
  #   const { chromium } = pw.default ?? pw;
  export PLAYWRIGHT="${playwrightModule}"
  export PLAYWRIGHT_BROWSERS_PATH="${browsers}"
  export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
  # The nix Chromium is rpath-patched and self-contained; a caller's dev-shell
  # LD_LIBRARY_PATH (e.g. older util-linux) breaks its glib. Drop it.
  # No-op on darwin, harmless.
  unset LD_LIBRARY_PATH
  exec ${pkgs.nodejs}/bin/node "$@"
''
