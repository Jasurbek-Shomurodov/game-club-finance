#!/bin/sh
# Waits for the "Project checks" run of a pushed commit (HEAD by default) and
# exits non-zero when it fails, printing the failed steps' logs. Run it after
# every push: `npm run ci:watch` or `npm run ci:watch -- <sha>`.
set -e
sha=$(git rev-parse "${1:-HEAD}")

run=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  run=$(gh run list --workflow checks.yml --commit "$sha" --limit 1 --json databaseId -q '.[0].databaseId')
  [ -n "$run" ] && break
  sleep 5
done
if [ -z "$run" ]; then
  echo "No Project checks run found for $sha. Was it pushed?" >&2
  exit 1
fi

if gh run watch "$run" --exit-status --interval 15 >/dev/null; then
  echo "Project checks passed for $(git rev-parse --short "$sha") (run $run)."
else
  echo "Project checks FAILED for $(git rev-parse --short "$sha") (run $run). Failed steps:" >&2
  gh run view "$run" --log-failed | tail -60 >&2
  exit 1
fi
