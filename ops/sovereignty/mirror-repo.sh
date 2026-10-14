#!/bin/sh
set -eu

# Non-destructive one-repository mirror into a user-controlled Forgejo/Gitea.
# Never embeds credentials in the remote URL or deletes the GitHub source.
: "${SOURCE_GIT_URL:?Set SOURCE_GIT_URL to the source repository URL}"
: "${FORGEJO_GIT_URL:?Set FORGEJO_GIT_URL to the destination repository URL}"
: "${FORGEJO_AUTH_HEADER:?Set FORGEJO_AUTH_HEADER to an HTTP authorization header}"

workdir=$(mktemp -d)
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT HUP INT TERM

git clone --mirror "$SOURCE_GIT_URL" "$workdir/repo.git"
git -C "$workdir/repo.git" -c http.extraHeader="$FORGEJO_AUTH_HEADER" push --mirror "$FORGEJO_GIT_URL"

# Verify the destination advertises the same refs before treating this as complete.
git ls-remote "$SOURCE_GIT_URL" | LC_ALL=C sort > "$workdir/source.refs"
git -c http.extraHeader="$FORGEJO_AUTH_HEADER" ls-remote "$FORGEJO_GIT_URL" | LC_ALL=C sort > "$workdir/destination.refs"
diff -u "$workdir/source.refs" "$workdir/destination.refs"

printf '%s\n' "Mirror refs verified. Source repository was not modified."
