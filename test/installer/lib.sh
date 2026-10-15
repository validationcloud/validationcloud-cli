#!/bin/bash
# Helpers shared by run.sh and docker.sh. Sourced, not executed; Bash 3.2 compatible.

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
PASSED=0
FAILED=0

pass() {
  PASSED=$((PASSED + 1))
  printf 'ok   %s\n' "$1"
}

fail() {
  FAILED=$((FAILED + 1))
  printf 'FAIL %s\n' "$1"
  if [ -n "${2:-}" ]; then printf '%s\n' "$2" | sed 's/^/     | /'; fi
}

skip() { printf 'SKIP %s\n' "$1"; }

finish() {
  printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
  [ "$FAILED" -eq 0 ]
}

# check NAME CONDITION-COMMAND... ; the command's output is shown only when it fails.
check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name" "${OUT:-}"; fi
}

contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

expect_contains() { # name text needle
  if contains "$2" "$3"; then pass "$1"; else fail "$1: expected to find '$3'" "$2"; fi
}

expect_equals() { # name actual expected
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: expected '$3', got '$2'"; fi
}

runtime_field() { # javascript expression over the pinned runtime
  (cd "$ROOT" && node -p "const runtime = require('./scripts/node-runtime.json'); $1")
}

node_tarball() { # platform: prints the cached tarball's directory after fetching it when missing
  local platform=$1 version name dir hash actual
  version=$(runtime_field 'runtime.version')
  name="node-v$version-$platform.tar.gz"
  dir="$NODE_CACHE/v$version"
  if [ ! -f "$dir/$name" ]; then
    mkdir -p "$dir"
    printf 'Downloading %s for the test cache...\n' "$name" >&2
    curl -fsSL -o "$dir/$name.part" "https://nodejs.org/dist/v$version/$name" || return 1
    mv "$dir/$name.part" "$dir/$name"
  fi
  hash=$(runtime_field "runtime.sha256['$platform']")
  actual=$(sha256_of "$dir/$name")
  [ "$hash" = "$actual" ] || {
    printf 'cached %s has the wrong checksum (%s)\n' "$name" "$actual" >&2
    return 1
  }
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum <"$1" | cut -d' ' -f1; else shasum -a 256 <"$1" | cut -d' ' -f1; fi
}

host_platform() { # the platform name the installer picks on this host (glibc Linux or macOS)
  local os arch
  case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
  case "$(uname -m)" in x86_64 | amd64) arch=x64 ;; *) arch=arm64 ;; esac
  printf '%s-%s\n' "$os" "$arch"
}

# A stand-in bundle: the installer only runs it with --version; --exec-argv and --fetch let the scenarios look at how the launcher starts Node.js.
make_stub_bundle() { # version dir
  mkdir -p "$2"
  cat >"$2/valcloud.mjs" <<EOF
const [, , mode, argument] = process.argv;
if (mode === "--version") console.log("$1");
else if (mode === "--exec-argv") console.log(JSON.stringify(process.execArgv));
else if (mode === "--fetch") {
  try {
    console.log(await (await fetch(argument, { signal: AbortSignal.timeout(15_000) })).text());
  } catch (error) {
    console.log("fetch failed: " + error);
    process.exit(1);
  }
}
else console.log("stub valcloud $1");
EOF
}

# render_installer VERSION BUNDLE_FILE OUT [file URL prefix of the bundle]
render_installer() {
  local version=$1 bundle=$2 out=$3
  (cd "$ROOT" && node scripts/render-installer.ts --version "$version" --bundle "$bundle" \
    --bundle-url "file://$bundle" --node-base "file://$NODE_CACHE" --out "$out")
}

setup_workspace() {
  local base=${TMPDIR:-/tmp}
  WORK=$(mktemp -d "${base%/}/valcloud-installer-test.XXXXXX")
  WORK=$(cd "$WORK" && pwd -P)
  NODE_CACHE=${VALCLOUD_TEST_NODE_CACHE:-${base%/}/valcloud-installer-test-cache}
  mkdir -p "$NODE_CACHE"
  NODE_CACHE=$(cd "$NODE_CACHE" && pwd -P)
  trap 'rm -rf "$WORK"' EXIT
}
