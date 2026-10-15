#!/bin/bash
# Installer checks in clean Linux containers: glibc, musl, too-old glibc, missing tools.
# Run it with /bin/bash. Needs docker and `node` (to render the installer) on the caller's PATH.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd -P)
# shellcheck source=lib.sh
. "$HERE/lib.sh"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}
setup_workspace
case "$(uname -m)" in aarch64 | arm64) NATIVE=linux/arm64 FOREIGN=linux/amd64 ;; *) NATIVE=linux/amd64 FOREIGN=linux/arm64 ;; esac

for platform in linux-x64 linux-arm64 linux-x64-musl; do
  node_tarball "$platform" || {
    echo "could not prepare the Node.js $platform tarball" >&2
    exit 1
  }
done
make_stub_bundle 0.1.0 "$WORK/rel/0.1.0"
make_stub_bundle 0.2.0 "$WORK/rel/0.2.0"
render_installer 0.1.0 "$WORK/rel/0.1.0/valcloud.mjs" "$WORK/install-0.1.0.sh"
render_installer 0.2.0 "$WORK/rel/0.2.0/valcloud.mjs" "$WORK/install-0.2.0.sh"

# in_container PLATFORM IMAGE SCRIPT: sets OUT and RC. The workspace and the Node.js cache are mounted at their host paths, which the rendered installers use in file:// URLs.
in_container() {
  local platform=$1 image=$2 script=$3
  OUT=$(docker run --rm --platform "$platform" -v "$WORK:$WORK:ro" -v "$NODE_CACHE:$NODE_CACHE:ro" \
    -e I1="$WORK/install-0.1.0.sh" -e I2="$WORK/install-0.2.0.sh" "$image" sh -c "$script" 2>&1)
  RC=$?
}

# The installer runs through `env -i` so that nothing from the image's environment, such as a Node.js on PATH, leaks in.
RUN="env -i HOME=/root PATH=/usr/bin:/bin:/usr/sbin:/sbin SHELL=/bin/bash bash"
VERSION_OF='env -i PATH=/usr/bin:/bin /root/.local/bin/valcloud --version'

supported() { docker run --rm --platform "$1" alpine:3.22 true >/dev/null 2>&1; }

matrix_platforms=$NATIVE
if supported "$FOREIGN"; then
  matrix_platforms="$NATIVE $FOREIGN"
else
  skip "$FOREIGN containers do not run on this host, so that architecture is not covered here"
fi

for platform in $matrix_platforms; do
  echo "# $platform"
  arch=${platform#linux/}

  in_container "$platform" debian:12-slim "apt-get -qq update >/dev/null && apt-get -qq install -y curl >/dev/null 2>&1; $RUN \$I1 && $VERSION_OF && $RUN \$I2 && $VERSION_OF && ls /root/.valcloud/runtime"
  expect_equals "debian:12 $arch: install then update exits 0" "$RC" 0
  expect_contains "debian:12 $arch: the launcher works with no Node.js on PATH" "$OUT" "0.1.0"
  expect_contains "debian:12 $arch: the update lands" "$OUT" "Updated valcloud 0.1.0 -> 0.2.0"
  if [ "$arch" = arm64 ]; then expected_runtime=node-v24.22.0-linux-arm64; else expected_runtime=node-v24.22.0-linux-x64; fi
  expect_contains "debian:12 $arch: the glibc runtime is chosen" "$OUT" "$expected_runtime"

  in_container "$platform" debian:12-slim "apt-get -qq update >/dev/null && apt-get -qq install -y curl musl >/dev/null 2>&1; ls /lib/ld-musl-* >/dev/null && $RUN \$I1 && $VERSION_OF && ls /root/.valcloud/runtime"
  expect_equals "debian:12 $arch with the musl package installs" "$RC" 0
  expect_contains "debian:12 $arch with the musl package runs" "$OUT" "0.1.0"
  expect_contains "debian:12 $arch with the musl package still gets the glibc runtime" "$OUT" "$expected_runtime"

  in_container "$platform" ubuntu:24.04 "apt-get -qq update >/dev/null && apt-get -qq install -y curl >/dev/null 2>&1; $RUN \$I1 && $VERSION_OF"
  expect_equals "ubuntu:24.04 $arch installs" "$RC" 0

  in_container "$platform" rockylinux:8 "$RUN \$I1 && $VERSION_OF"
  expect_equals "rockylinux:8 $arch (glibc 2.28, the floor) installs" "$RC" 0
  expect_contains "rockylinux:8 $arch runs" "$OUT" "0.1.0"

  for old in amazonlinux:2 ubuntu:18.04; do
    in_container "$platform" "$old" "$RUN \$I1"
    expect_equals "$old $arch is refused" "$RC" 1
    expect_contains "$old $arch: the message names glibc 2.28" "$OUT" "needs glibc 2.28 or newer"
  done

  in_container "$platform" amazonlinux:2023 "$RUN \$I1; dnf -q install -y tar gzip >/dev/null 2>&1; $RUN \$I1 && $VERSION_OF"
  expect_contains "amazonlinux:2023 $arch without tar and gzip names them and the command" "$OUT" "missing required tools: tar gzip. Install them (for example: dnf install -y tar gzip)"
  expect_contains "amazonlinux:2023 $arch installs once they exist" "$OUT" "0.1.0"

  in_container "$platform" redhat/ubi9-minimal "$RUN \$I1"
  expect_contains "ubi9-minimal $arch suggests microdnf" "$OUT" "microdnf install -y tar gzip"
done

echo "# musl"
if supported linux/amd64; then
  in_container linux/amd64 alpine:3.22 "apk add -q bash curl >/dev/null; $RUN \$I1; apk add -q libstdc++ >/dev/null; $RUN \$I1 && $VERSION_OF && ls /root/.valcloud/runtime"
  expect_contains "alpine x86_64 without libstdc++ is refused with the fix" "$OUT" "apk add libstdc++"
  expect_contains "alpine x86_64 with libstdc++ runs" "$OUT" "0.1.0"
  expect_contains "alpine x86_64 gets the musl runtime" "$OUT" "node-v24.22.0-linux-x64-musl"
else
  skip "alpine x86_64: linux/amd64 containers do not run on this host"
fi
if supported linux/arm64; then
  in_container linux/arm64 alpine:3.22 "apk add -q bash curl >/dev/null; $RUN \$I1"
  expect_equals "alpine arm64 is refused" "$RC" 1
  expect_contains "alpine arm64: the message says musl is x86_64 only" "$OUT" "supported only on x86_64"
else
  skip "alpine arm64: linux/arm64 containers do not run on this host"
fi

finish
