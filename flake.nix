{
  description = "Schema Labs CLI toolkit";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
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
      devShells = forAllSystems (_system: pkgs: {
        default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            nodePackages.npm
          ];

          shellHook = ''
            echo "Schema Labs Toolkit"
            echo ""
            echo "Available tools:"
            echo "  npx tsx tools/poster-qr.ts --help"
            echo ""
          '';
        };
      });
    };
}
