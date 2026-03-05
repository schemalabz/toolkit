{
  description = "Schema Labs CLI toolkit";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f system (import nixpkgs { inherit system; }));
    in {
      devShells = forAllSystems (_system: pkgs:
        let
          # Libraries that need to be on LD_LIBRARY_PATH for Tauri on Linux
          tauriLibs = with pkgs; [
            webkitgtk_4_1
            gtk3
            cairo
            gdk-pixbuf
            glib
            dbus
            openssl
            librsvg
            libsoup_3
            glib-networking
          ];
        in {
        default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            pkg-config
          ];

          buildInputs = with pkgs; [
            nodejs
            nodePackages.npm
            bun
            rustc
            cargo
            yt-dlp
            ffmpeg
          ] ++ lib.optionals stdenv.isLinux ([
            webkitgtk_4_1
            gtk3
            libsoup_3
            openssl
            cairo
            gdk-pixbuf
            glib
            dbus
            librsvg
            glib-networking
            gsettings-desktop-schemas
          ]) ++ lib.optionals stdenv.isDarwin [
            darwin.apple_sdk.frameworks.WebKit
          ];

          shellHook = ''
            echo "Schema Labs Toolkit"
            echo ""
            echo "Available tools:"
            echo "  npm run poster-qr  -- --help"
            echo "  npm run yt-download -- --help"
            echo "  npm run app:dev    # Launch desktop app in dev mode"
            echo "  npm run app:build  # Build distributable app"
            echo ""
          '' + pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath tauriLibs}:$LD_LIBRARY_PATH
            export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"
          '';
        };
      });
    };
}
