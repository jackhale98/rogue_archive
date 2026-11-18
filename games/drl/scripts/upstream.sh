#!/usr/bin/env bash
# Resolves which upstream DRL and FPC Valkyrie sources to use. Sourced by
# build.sh and test-engine.sh.
#
# Normally these are the pins in upstream.env. For canary runs (checking
# whether a newer upstream still works with the port, before deliberately
# updating the pin), set ROGUE_ARCHIVE_UPSTREAM_REF to a DRL tag, a branch, or
# "latest-release". FPC Valkyrie follows: the same branch, the tag of the same
# release (DRL's hotfix letters dropped: 0_10_12c is Valkyrie's 0_10_12), or
# its development branch.
_ra_game_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../upstream.env
source "$_ra_game_dir/upstream.env"

# The commit a ref names in a repository: an annotated tag is listed twice,
# the tag object and then the commit it points to (`<tag>^{}`); take the
# commit. A branch or a lightweight tag has one line.
ra_resolve_ref() {
  local repo="$1" ref="$2" refs commit
  refs="$(git ls-remote "$repo" "refs/tags/$ref" "refs/tags/$ref^{}" "refs/heads/$ref")"
  commit="$(printf '%s\n' "$refs" | awk '$2 ~ /\^\{\}$/ { print $1; exit }')"
  [ -n "$commit" ] || commit="$(printf '%s\n' "$refs" | head -1 | cut -f1)"
  printf '%s' "$commit"
}

RA_CANARY=""
if [ -n "${ROGUE_ARCHIVE_UPSTREAM_REF:-}" ]; then
  ref="$ROGUE_ARCHIVE_UPSTREAM_REF"
  if [ "$ref" = "latest-release" ]; then
    ref="$(git ls-remote --tags --refs "$UPSTREAM_REPO" | sed 's#.*refs/tags/##' | grep -E '^[0-9]+_[0-9]+_[0-9]+[a-z]?$' | sort -V | tail -1)"
  fi
  commit="$(ra_resolve_ref "$UPSTREAM_REPO" "$ref")"
  if [ -z "$commit" ]; then
    echo "error: upstream ref $ref not found" >&2
    exit 1
  fi
  vref="$ref"
  vcommit="$(ra_resolve_ref "$VALKYRIE_REPO" "$vref")"
  if [ -z "$vcommit" ]; then
    vref="${ref%[a-z]}"
    vcommit="$(ra_resolve_ref "$VALKYRIE_REPO" "$vref")"
  fi
  if [ -z "$vcommit" ]; then
    vref=development
    vcommit="$(ra_resolve_ref "$VALKYRIE_REPO" "$vref")"
  fi
  UPSTREAM_TAG="$ref"
  UPSTREAM_COMMIT="$commit"
  UPSTREAM_VERSION="$ref"
  VALKYRIE_TAG="$vref"
  VALKYRIE_COMMIT="$vcommit"
  RA_CANARY=1
  echo "note: canary run against upstream DRL $ref ($commit), FPC Valkyrie $vref ($vcommit), not the pinned versions" >&2
fi

# Clones (once) `repo` at `ref` into `dir` and checks it is at `commit`.
ra_checkout() {
  local repo="$1" ref="$2" commit="$3" dir="$4" actual
  if [ ! -d "$dir/.git" ]; then
    rm -rf "$dir"
    git clone --quiet --depth 1 --branch "$ref" "$repo" "$dir"
  fi
  actual="$(git -C "$dir" rev-parse HEAD)"
  if [ "$actual" != "$commit" ]; then
    echo "error: $repo $ref resolved to $actual, expected $commit" >&2
    exit 1
  fi
  git -C "$dir" checkout --quiet -- .
  git -C "$dir" clean --quiet -fdx
}
