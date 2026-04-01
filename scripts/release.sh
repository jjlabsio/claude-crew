#!/bin/bash
set -euo pipefail

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Ensure on main branch
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Error: must be on main branch (currently on $BRANCH)"
  exit 1
fi

# 1. Generate changelog and bump version in package.json (no commit/tag yet)
npx changelogen --bump --no-commit --no-tag

# 2. Read bumped version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "Releasing v$VERSION..."

# 3. Sync version to plugin files
node -e "
const fs = require('fs');
const version = '$VERSION';
const files = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.version = version;
  if (data.plugins) {
    data.plugins[0].version = version;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('  Synced ' + file);
}
"

# 4. Commit, tag, push
git add -A
git commit -m "chore(release): v$VERSION"
git tag "v$VERSION"
git push --follow-tags

# 5. Create GitHub release with changelog
npx changelogen gh release

echo ""
echo "Released v$VERSION"
echo "https://github.com/jjlabsio/claude-crew/releases/tag/v$VERSION"
