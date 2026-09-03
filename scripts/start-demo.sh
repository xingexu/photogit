#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
demo_root="$repository_root/.demo-project"
config_path="$repository_root/.demo-helper.json"

cd "$repository_root"
npm run build

if [ ! -f "$demo_root/.photogit/project.json" ]; then
  node cli/dist/main.js init "$demo_root"
  git -C "$demo_root" config user.name "PhotoGit Demo"
  git -C "$demo_root" config user.email "demo@photogit.invalid"
  cp packages/test-fixtures/captures/basic-document.json "$demo_root/.photogit/capture.json"
  (cd "$demo_root" && node ../cli/dist/main.js save -m "Initial Photoshop design")
fi

git -C "$demo_root" lfs install --local
printf 'PhotoGit demo project: %s\n' "$demo_root"
printf 'Keep this window open while using the Photoshop panel.\n'
PHOTOGIT_HELPER_CONFIG="$config_path" node apps/desktop-helper/dist/main.js --approve-root "$demo_root"
