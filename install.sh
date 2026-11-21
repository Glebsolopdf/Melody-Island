#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
uuid=by@substitute.me
source_dir="$root/$uuid"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
mkdir -p "$dest"
cp -R "$source_dir/." "$dest/"
glib-compile-schemas --strict "$dest/schemas"
# Remove only unchanged files managed by releases before src/services existed.
for module in mpris.js visualizer.js; do
    legacy="$dest/$module"
    if [ -f "$legacy" ] && cmp -s "$legacy" "$source_dir/src/services/$module"; then
        unlink "$legacy"
    fi
done
# Remove the unmodified old thumbnail service; keep any user-modified copy.
legacy_art="$dest/src/services/artwork.js"
if [ -f "$legacy_art" ]; then
    legacy_hash=$(sha256sum "$legacy_art" | cut -d ' ' -f 1)
    if [ "$legacy_hash" = '1c43123bb89a808f9cad5ce14c266240f74f6a134e7106b0b7748a25aa0a2192' ]; then
        unlink "$legacy_art"
    fi
fi
printf 'Installed: %s\nEnable after GNOME detects it: gnome-extensions enable %s\n' "$dest" "$uuid"
