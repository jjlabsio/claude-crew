#!/bin/bash
set -euo pipefail

# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.2.0

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  CURRENT=$(node -p "require('./package.json').version")
  echo "Current version: $CURRENT"
  echo "Usage: ./scripts/release.sh <version>"
  exit 1
fi

# Validate semver format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: version must be semver (e.g., 0.2.0)"
  exit 1
fi

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

echo "Bumping version to $VERSION..."

# Update all three files
node -e "
const fs = require('fs');
const files = [
  'package.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json'
];
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.plugins) {
    data.plugins[0].version = '$VERSION';
  }
  data.version = '$VERSION';
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('  Updated ' + file);
}
"

# Commit, tag, push
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push && git push --tags

echo ""
echo "Released v$VERSION"
echo "https://github.com/jjlabsio/claude-crew/releases/tag/v$VERSION"
