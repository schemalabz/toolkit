{ pkgs }:
# page-read: URL->markdown reader. `pkgs` MUST come from the `nixpkgs-playwright`
# input — it provides the matched playwright module + Chromium, imported at
# runtime via $PLAYWRIGHT (same contract as playwright-run).
let
  playwrightModule = "${pkgs.playwright-test}/lib/node_modules/playwright/index.js";
  browsers = pkgs.playwright-driver.browsers;
in
pkgs.buildNpmPackage {
  pname = "page-read";
  version = "0.1.0";
  src = ../tools/page-read;
  npmDepsHash = "sha256-BxWa0D8G2yArFewejieof0ykj0nnrOC0Ikrndan91Ak=";
  dontNpmBuild = true;
  nativeBuildInputs = [ pkgs.makeWrapper ];
  postInstall = ''
    wrapProgram $out/bin/page-read \
      --set PLAYWRIGHT "${playwrightModule}" \
      --set PLAYWRIGHT_BROWSERS_PATH "${browsers}" \
      --set PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS 1 \
      --unset LD_LIBRARY_PATH
  '';
  meta.mainProgram = "page-read";
}
