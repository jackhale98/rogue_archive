#!/usr/bin/env bash
# Prints, for each game, the pinned upstream version and upstream's latest
# release, as each game's own scripts/upstream.sh resolves "latest-release"
# (the same rule the weekly canary uses). One line per game:
#   <game> <status> <pinned tag> <latest tag> <latest commit> <repo>
# status: current | behind | unknown (the latest release could not be resolved).
# Used by .github/workflows/upstream-releases.yml.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for script in "$ROOT"/games/*/scripts/upstream.sh; do
  game="$(basename "$(dirname "$(dirname "$script")")")"
  # shellcheck disable=SC1090
  pinned_tag="$(source "$(dirname "$script")/../upstream.env" && echo "$UPSTREAM_TAG")"
  pinned_commit="$(source "$(dirname "$script")/../upstream.env" && echo "$UPSTREAM_COMMIT")"
  repo="$(source "$(dirname "$script")/../upstream.env" && echo "$UPSTREAM_REPO")"
  # shellcheck disable=SC1090
  latest="$(ROGUE_ARCHIVE_UPSTREAM_REF=latest-release bash -c 'source "$1" && echo "$UPSTREAM_TAG $UPSTREAM_COMMIT"' _ "$script" 2>/dev/null)"
  latest_tag="${latest%% *}"
  latest_commit="${latest##* }"
  if [ -z "$latest" ] || [ -z "$latest_tag" ] || [ -z "$latest_commit" ]; then
    echo "$game unknown $pinned_tag - - $repo"
  elif [ "$latest_commit" = "$pinned_commit" ] || [ "$latest_tag" = "$pinned_tag" ]; then
    echo "$game current $pinned_tag $latest_tag $latest_commit $repo"
  else
    echo "$game behind $pinned_tag $latest_tag $latest_commit $repo"
  fi
done
