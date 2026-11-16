#!/usr/bin/env bash
# Resolves which upstream Brogue CE source to use. Sourced by build.sh and test-engine.sh.
#
# Normally this is the pin in upstream.env. For canary runs (checking whether a
# newer upstream still works with the port, before deliberately updating the
# pin), set ROGUE_ARCHIVE_UPSTREAM_REF to a tag, a branch, or "latest-release".
_ra_game_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../upstream.env
source "$_ra_game_dir/upstream.env"
RA_CANARY=""
if [ -n "${ROGUE_ARCHIVE_UPSTREAM_REF:-}" ]; then
  ref="$ROGUE_ARCHIVE_UPSTREAM_REF"
  if [ "$ref" = "latest-release" ]; then
    ref="$(git ls-remote --tags --refs "$UPSTREAM_REPO" 'v*' | sed 's#.*refs/tags/##' | grep -E '^v[0-9.]+$' | sort -V | tail -1)"
  fi
  # An annotated tag is listed twice, the tag object and then the commit it
  # points to (`<tag>^{}`): take the commit. A branch or a lightweight tag has one line.
  refs="$(git ls-remote "$UPSTREAM_REPO" "refs/tags/$ref" "refs/tags/$ref^{}" "refs/heads/$ref")"
  commit="$(printf '%s\n' "$refs" | awk '$2 ~ /\^\{\}$/ { print $1; exit }')"
  [ -n "$commit" ] || commit="$(printf '%s\n' "$refs" | head -1 | cut -f1)"
  if [ -z "$commit" ]; then
    echo "error: upstream ref $ref not found" >&2
    exit 1
  fi
  UPSTREAM_TAG="$ref"
  UPSTREAM_COMMIT="$commit"
  UPSTREAM_VERSION="$ref"
  RA_CANARY=1
  echo "note: canary run against upstream $ref ($commit), not the pinned version" >&2
fi
