# Shared by the hooks (sourced, not run). Checks run in $SNAPSHOT, a temporary
# copy of exactly the tree being committed or pushed, with this checkout's
# node_modules linked in, so unstaged edits and untracked files in the working
# tree can neither fail nor pass a check. The copy is removed on exit.
repo=$(git rev-parse --show-toplevel)
SNAPSHOT=$(mktemp -d "${TMPDIR:-/tmp}/game-club-hook.XXXXXX")
trap 'rm -rf "$SNAPSHOT"' EXIT

link_node_modules() {
  ln -s "$repo/node_modules" "$SNAPSHOT/node_modules"
}

# The staged files (the index git is about to commit).
snapshot_index() {
  git checkout-index --all --prefix="$SNAPSHOT/"
  link_node_modules
}

# The files of one commit, for the browser suite's production build. Turbopack
# cannot resolve `next` through a node_modules symlink that points outside the
# project, so node_modules is cloned instead (copy-on-write on APFS, ~10 s, no
# extra disk); where cloning is unavailable it falls back to the symlink.
snapshot_commit() {
  git archive "$1" | tar -x -C "$SNAPSHOT"
  cp -cR "$repo/node_modules" "$SNAPSHOT/node_modules" 2>/dev/null || {
    rm -rf "$SNAPSHOT/node_modules"
    link_node_modules
  }
}
