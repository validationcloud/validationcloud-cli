#!/bin/bash
# Installer scenarios on this host, with the stub bundles and the real pinned Node.js runtime.
# Run it with /bin/bash (Bash 3.2 on macOS). Needs `node` on the caller's PATH to render the installer, and the built release bundle (pnpm run build:release).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd -P)
# shellcheck source=lib.sh
. "$HERE/lib.sh"

PLATFORM=$(host_platform)
setup_workspace
node_tarball "$PLATFORM" || {
  echo "could not prepare the Node.js $PLATFORM tarball" >&2
  exit 1
}

# The installer runs with this PATH: no Node.js anywhere on it.
BASE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
if PATH=$BASE_PATH command -v node >/dev/null 2>&1; then
  echo "node is on $BASE_PATH, so scenarios without Node.js on PATH would prove nothing" >&2
  exit 1
fi

for version in 0.1.0 0.2.0; do
  make_stub_bundle "$version" "$WORK/rel/$version"
  render_installer "$version" "$WORK/rel/$version/valcloud.mjs" "$WORK/install-$version.sh"
done
INSTALL_1=$WORK/install-0.1.0.sh
INSTALL_2=$WORK/install-0.2.0.sh

HOME_COUNT=0
new_home() {
  HOME_COUNT=$((HOME_COUNT + 1))
  H=$WORK/home$HOME_COUNT
  mkdir -p "$H"
}

# run_installer INSTALLER [VAR=value ...] with HOME=$H, SHELL=$SHELL_UNDER_TEST and PATH=$RUN_PATH; sets OUT and RC.
run_installer() {
  local installer=$1
  shift
  # shellcheck disable=SC2002 # a pipe, as in curl | bash, not a file on stdin
  OUT=$(cat "$installer" | env -i HOME="$H" PATH="${RUN_PATH:-$BASE_PATH}" SHELL="${SHELL_UNDER_TEST-/bin/zsh}" "$@" /bin/bash 2>&1)
  RC=$?
}

launcher_version() { env -i PATH="$BASE_PATH" "$1" --version 2>&1; }

profile_lines() { grep -c 'added by the valcloud installer' "$1" 2>/dev/null || true; }

stray_work_dirs() { find "$1" -maxdepth 1 -name '.install.*' 2>/dev/null | wc -l | tr -d ' '; }

echo "# fresh install, rerun, update"
new_home
mkdir -p "$H/zdot"
run_installer "$INSTALL_1" ZDOTDIR="$H/zdot"
expect_equals "fresh install exits 0" "$RC" 0
expect_contains "fresh install says what it installed" "$OUT" "Installed valcloud 0.1.0 at $H/.local/bin/valcloud"
expect_contains "fresh install points at auth login" "$OUT" "Next: valcloud auth login"
expect_equals "launcher runs without Node.js on PATH" "$(launcher_version "$H/.local/bin/valcloud")" 0.1.0
check "launcher carries the ownership marker" grep -qF '# managed by the valcloud installer' "$H/.local/bin/valcloud"
check "install dir carries the installer marker" test -f "$H/.valcloud/.valcloud-installer"
expect_equals "ZDOTDIR .zshrc gets one PATH line" "$(profile_lines "$H/zdot/.zshrc")" 1
check "the home .zshrc is untouched when ZDOTDIR is set" test ! -e "$H/.zshrc"
expect_equals "no work dir is left behind" "$(stray_work_dirs "$H/.valcloud")" 0

run_installer "$INSTALL_1" ZDOTDIR="$H/zdot"
expect_equals "rerun exits 0" "$RC" 0
expect_contains "rerun reports the runtime check" "$OUT" "valcloud 0.1.0 is already installed"
expect_equals "rerun adds no second PATH line" "$(profile_lines "$H/zdot/.zshrc")" 1

run_installer "$INSTALL_2" ZDOTDIR="$H/zdot"
expect_equals "update exits 0" "$RC" 0
expect_contains "update reports both versions" "$OUT" "Updated valcloud 0.1.0 -> 0.2.0"
expect_equals "launcher runs the new version" "$(launcher_version "$H/.local/bin/valcloud")" 0.2.0
expect_equals "only the new bundle remains" "$(ls "$H/.valcloud/lib")" valcloud-0.2.0.mjs
expect_equals "only one runtime remains" "$(find "$H/.valcloud/runtime" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 1

echo "# repair"
printf '' >"$H/.valcloud/runtime/node-v$(runtime_field 'runtime.version')-$PLATFORM/bin/node"
run_installer "$INSTALL_2" ZDOTDIR="$H/zdot"
expect_equals "a truncated runtime is repaired by rerunning" "$(launcher_version "$H/.local/bin/valcloud")" 0.2.0
rm -rf "$H/.valcloud/runtime"
mkdir -p "$H/.valcloud/runtime/node-v$(runtime_field 'runtime.version')-$PLATFORM/include"
run_installer "$INSTALL_2" ZDOTDIR="$H/zdot"
expect_equals "a runtime dir without node is repaired" "$(launcher_version "$H/.local/bin/valcloud")" 0.2.0

new_home
run_installer "$INSTALL_1"
run_installer "$INSTALL_1" VALCLOUD_BIN_DIR="$H/otherbin"
expect_equals "a rerun with another bin dir exits 0" "$RC" 0
expect_contains "the note says the existing PATH line is for another directory" "$OUT" "has a valcloud PATH line for another directory, so $H/otherbin was not added"
expect_equals "the other bin dir adds no second PATH line" "$(profile_lines "$H/.zshrc")" 1

echo "# launcher ownership"
new_home
mkdir -p "$H/.local/bin"
printf '#!/bin/sh\necho foreign\n' >"$H/.local/bin/valcloud"
chmod +x "$H/.local/bin/valcloud"
run_installer "$INSTALL_1"
expect_equals "a foreign launcher stops the install" "$RC" 1
expect_contains "the message names the cause" "$OUT" "was not created by this installer"
expect_equals "the foreign launcher is untouched" "$(sh "$H/.local/bin/valcloud")" foreign
check "nothing was downloaded or created" test ! -e "$H/.valcloud"
new_home
mkdir -p "$H/.local/bin"
ln -s /usr/bin/true "$H/.local/bin/valcloud"
run_installer "$INSTALL_1"
expect_equals "a foreign symlink stops the install" "$RC" 1
check "the symlink is untouched" test -L "$H/.local/bin/valcloud"

echo "# PATH handling"
new_home
mkdir -p "$H/.local/bin" "$H/other"
printf '#!/bin/sh\necho npm\n' >"$H/other/valcloud"
chmod +x "$H/other/valcloud"
RUN_PATH=$H/other:$H/.local/bin:$BASE_PATH run_installer "$INSTALL_1"
expect_equals "install with the bin dir on PATH exits 0" "$RC" 0
expect_contains "a copy earlier on PATH is reported" "$OUT" "Warning: $H/other/valcloud comes before"
check "no profile is touched when the bin dir is on PATH" test ! -e "$H/.zshrc"
new_home
mkdir -p "$H/other"
printf '#!/bin/sh\necho npm\n' >"$H/other/valcloud"
chmod +x "$H/other/valcloud"
RUN_PATH=$H/other:$BASE_PATH run_installer "$INSTALL_1"
expect_contains "another copy with the bin dir off PATH is noted" "$OUT" "Note: another valcloud is installed at $H/other/valcloud"

new_home
SHELL_UNDER_TEST=/usr/bin/fish run_installer "$INSTALL_1" XDG_CONFIG_HOME="$H/xdg"
check "fish gets a conf.d file" grep -qF 'set -gx PATH' "$H/xdg/fish/conf.d/valcloud.fish"
new_home
SHELL_UNDER_TEST=/usr/bin/tcsh run_installer "$INSTALL_1"
expect_contains "an unknown shell is told what to add" "$OUT" "is not on your PATH. Add it in your shell's startup file"
new_home
if [ "$(uname -s)" = Darwin ]; then
  echo '# mine' >"$H/.profile"
  SHELL_UNDER_TEST=/bin/bash run_installer "$INSTALL_1"
  check "bash on macOS appends to an existing .profile" grep -qF 'added by the valcloud installer' "$H/.profile"
  check "bash on macOS leaves .bash_profile alone when .profile exists" test ! -e "$H/.bash_profile"
else
  echo '# mine' >"$H/.bashrc"
  SHELL_UNDER_TEST=/bin/bash run_installer "$INSTALL_1"
  check "bash on Linux appends to an existing .bashrc" grep -qF 'added by the valcloud installer' "$H/.bashrc"
fi
new_home
echo '# mine' >"$H/.profile"
SHELL_UNDER_TEST=/bin/bash run_installer "$INSTALL_1"
check "bash without a .bashrc appends to the login file that exists (.profile)" grep -qF 'added by the valcloud installer' "$H/.profile"
check "bash without a .bashrc does not create one" test ! -e "$H/.bashrc"
new_home
run_installer "$INSTALL_1" ZDOTDIR="$H/zdot"
expect_equals "a .zshrc the installer creates starts with the PATH line, not a blank line" "$(head -n 1 "$H/zdot/.zshrc" | cut -c1-12)" "export PATH="
new_home
SHELL_UNDER_TEST='' run_installer "$INSTALL_1"
expect_equals "an empty SHELL does not crash" "$RC" 0

echo "# custom directories"
new_home
run_installer "$INSTALL_1" "VALCLOUD_INSTALL_DIR=$H/it's here" "VALCLOUD_BIN_DIR=$H/my bin"
expect_equals "install paths with a space and a quote exit 0" "$RC" 0
expect_equals "the launcher survives them" "$(launcher_version "$H/my bin/valcloud")" 0.1.0
run_installer "$INSTALL_1" VALCLOUD_INSTALL_DIR=relative/dir
expect_contains "a relative install dir is refused" "$OUT" "must be absolute paths"

echo "# install dir safety"
new_home
mkdir -p "$H/shared/runtime/my-important-thing" "$H/shared/lib"
echo notes >"$H/shared/notes.txt"
echo keep >"$H/shared/lib/valcloud-notes.mjs"
run_installer "$INSTALL_1" VALCLOUD_INSTALL_DIR="$H/shared"
expect_equals "a non-empty dir without the marker is refused" "$RC" 1
expect_contains "the message says why" "$OUT" "was not created by this installer"
check "its files are untouched" test -f "$H/shared/lib/valcloud-notes.mjs" -a -d "$H/shared/runtime/my-important-thing" -a -f "$H/shared/notes.txt"
check "no launcher was written" test ! -e "$H/.local/bin/valcloud"
run_installer "$INSTALL_1" VALCLOUD_INSTALL_DIR="$H"
expect_equals "HOME itself is refused as an install dir" "$RC" 1

new_home
run_installer "$INSTALL_1" VALCLOUD_INSTALL_DIR="$H/shared"
mkdir -p "$H/shared/runtime/my-important-thing" "$H/shared/runtime/node-v1.0.0-old-1"
echo keep >"$H/shared/lib/valcloud-notes.mjs"
echo old >"$H/shared/lib/valcloud-0.0.1.mjs"
mkdir "$H/shared/.install.stale" "$H/shared/.install.fresh"
touch -t 202001010000 "$H/shared/.install.stale"
run_installer "$INSTALL_2" VALCLOUD_INSTALL_DIR="$H/shared"
expect_equals "update in a marked dir exits 0" "$RC" 0
check "foreign names survive cleanup" test -d "$H/shared/runtime/my-important-thing" -a -f "$H/shared/lib/valcloud-notes.mjs"
check "the installer's own old versions are removed" test ! -e "$H/shared/runtime/node-v1.0.0-old-1" -a ! -e "$H/shared/lib/valcloud-0.0.1.mjs" -a ! -e "$H/shared/lib/valcloud-0.1.0.mjs"
check "a stale work dir is removed" test ! -e "$H/shared/.install.stale"
check "a fresh work dir (maybe another run) is kept" test -d "$H/shared/.install.fresh"

echo "# integrity"
new_home
sed "s/^VALCLOUD_SHA256='.\{8\}/VALCLOUD_SHA256='deadbeef/" "$INSTALL_1" >"$WORK/tampered.sh"
run_installer "$WORK/tampered.sh"
expect_equals "a bundle with the wrong hash is refused" "$RC" 1
expect_contains "the message says nothing was installed" "$OUT" "valcloud was not installed or changed"
check "no launcher exists" test ! -e "$H/.local/bin/valcloud"
check "no bundle exists" test ! -e "$H/.valcloud/lib/valcloud-0.1.0.mjs"
expect_equals "the work dir is removed" "$(stray_work_dirs "$H/.valcloud")" 0

new_home
NODE_HASH_VARIABLE=NODE_SHA256_$(printf '%s' "$PLATFORM" | tr 'a-z-' 'A-Z_')
sed "s/^$NODE_HASH_VARIABLE='.\{8\}/$NODE_HASH_VARIABLE='deadbeef/" "$INSTALL_1" >"$WORK/tampered-node.sh"
run_installer "$WORK/tampered-node.sh"
expect_equals "a runtime with the wrong hash is refused" "$RC" 1
expect_contains "the runtime message says nothing was installed" "$OUT" "valcloud was not installed or changed"

echo "# new launcher is validated before it replaces the old one"
new_home
run_installer "$INSTALL_1"
# This bundle passes the installer's own check but fails once it sits in lib/ under its final name.
mkdir -p "$WORK/rel/0.3.0"
printf 'console.log(import.meta.url.endsWith("/valcloud.mjs") ? "0.3.0" : "broken");\n' >"$WORK/rel/0.3.0/valcloud.mjs"
render_installer 0.3.0 "$WORK/rel/0.3.0/valcloud.mjs" "$WORK/install-0.3.0.sh"
run_installer "$WORK/install-0.3.0.sh"
expect_equals "an update whose launcher fails is refused" "$RC" 1
expect_contains "the message says the launcher was not changed" "$OUT" "was not changed"
expect_equals "the previous launcher still works" "$(launcher_version "$H/.local/bin/valcloud")" 0.1.0
check "no temp launcher is left" test -z "$(find "$H/.local/bin" -name '.valcloud.tmp.*')"
sed 's/^VALCLOUD_VERSION=.*/VALCLOUD_VERSION='"'"'9.9.9'"'"'/' "$INSTALL_2" >"$WORK/lying.sh"
run_installer "$WORK/lying.sh"
expect_equals "a bundle that reports another version is refused" "$RC" 1
expect_equals "the working launcher is still in place" "$(launcher_version "$H/.local/bin/valcloud")" 0.1.0

echo "# failure handling and hardening"
mkdir -p "$WORK/shims-fail"

# F1: an unwritable profile is reported, not claimed as written.
new_home
mkdir -p "$H/.zshrc"
run_installer "$INSTALL_1"
expect_equals "an unwritable profile does not fail a working install" "$RC" 0
expect_contains "the note says the profile could not be written" "$OUT" "Could not write $H/.zshrc"
# shellcheck disable=SC2016 # $HOME and $PATH are literal text in the profile line
expect_contains "the note gives the line to add" "$OUT" 'yourself: export PATH="$HOME/.local/bin:$PATH"'
check "the note does not claim the line was added" test "$(printf '%s' "$OUT" | grep -c '^Added ')" = 0

# F2: an unwritable bin dir fails before any download.
if [ "$(id -u)" = 0 ]; then
  skip "unwritable bin dir: permissions do not bind root"
else
  new_home
  mkdir -p "$H/bin"
  chmod 555 "$H/bin"
  run_installer "$INSTALL_1" VALCLOUD_BIN_DIR="$H/bin"
  chmod 755 "$H/bin"
  expect_equals "an unwritable bin dir is refused" "$RC" 1
  expect_contains "the message names the dir and suggests chown" "$OUT" "cannot write to $H/bin"
  expect_contains "the message suggests chown" "$OUT" "sudo chown -R"
  check "nothing was downloaded or created before the failure" test ! -e "$H/.valcloud"
fi

# F3: sudo, and a HOME owned by someone else.
mkdir -p "$WORK/shims-sudo"
# shellcheck disable=SC2016 # the shim's own variables must stay literal
printf '#!/bin/sh\n[ "${1:-}" = -u ] && { echo 0; exit 0; }\nPATH=%s exec id "$@"\n' "$BASE_PATH" >"$WORK/shims-sudo/id"
chmod +x "$WORK/shims-sudo/id"
new_home
RUN_PATH=$WORK/shims-sudo:$BASE_PATH run_installer "$INSTALL_1" SUDO_USER=someone
expect_equals "root through sudo is refused" "$RC" 1
expect_contains "the message says why" "$OUT" "running as root through sudo"
check "sudo: nothing was created" test ! -e "$H/.valcloud"
new_home
RUN_PATH=$WORK/shims-sudo:$BASE_PATH run_installer "$INSTALL_1"
check "root without SUDO_USER (a container) is not refused for sudo" test "$(printf '%s' "$OUT" | grep -c 'through sudo')" = 0
if [ "$(id -u)" = 0 ]; then
  skip "HOME owned by someone else: the scenario needs a non-root user"
else
  new_home
  run_installer "$INSTALL_1" HOME=/
  expect_equals "a HOME owned by another user is refused" "$RC" 1
  expect_contains "the message says why" "$OUT" "is not owned by the user running the installer"
fi

# F4: . and .. components.
new_home
run_installer "$INSTALL_1" VALCLOUD_INSTALL_DIR="$H/missing/.."
expect_equals "an install dir ending in .. is refused" "$RC" 1
expect_contains "the message names the components" "$OUT" "must not contain . or .. components"
run_installer "$INSTALL_1" VALCLOUD_BIN_DIR="$H/a/./b"
expect_equals "a bin dir with a . component is refused" "$RC" 1
check ".. refusal: nothing was created" test ! -e "$H/.valcloud"

# F9: characters that would break the profile line.
new_home
# shellcheck disable=SC2016 # the names are literal
for bad in 'a"b' 'a$b' 'a`b' 'a\b'; do
  run_installer "$INSTALL_1" VALCLOUD_BIN_DIR="$H/$bad"
  expect_equals "a bin dir containing $bad is refused" "$RC" 1
done
expect_contains "the message names the characters" "$OUT" "must not contain a double quote, dollar sign, backtick or backslash"

# F5: a failed cleanup does not fail or hide a finished install.
new_home
run_installer "$INSTALL_1"
mkdir -p "$H/.valcloud/runtime/node-v1.0.0-old-1"
cat >"$WORK/shims-fail/rm" <<EOF
#!/bin/sh
case "\$*" in *old-1*) echo "rm: simulated failure" >&2; exit 1 ;; esac
PATH=$BASE_PATH exec rm "\$@"
EOF
chmod +x "$WORK/shims-fail/rm"
rm -f "$H/.zshrc"
RUN_PATH=$WORK/shims-fail:$BASE_PATH run_installer "$INSTALL_2"
expect_equals "a failed cleanup still exits 0" "$RC" 0
expect_contains "the failed cleanup is a warning" "$OUT" "Warning: could not remove the old file $H/.valcloud/runtime/node-v1.0.0-old-1"
expect_equals "the update landed" "$(launcher_version "$H/.local/bin/valcloud")" 0.2.0
check "the PATH setup ran despite the failed cleanup" grep -qF 'added by the valcloud installer' "$H/.zshrc"
rm -f "$WORK/shims-fail/rm"

# F6: the reason a check failed is shown, and NODE_OPTIONS is named.
new_home
run_installer "$INSTALL_1" NODE_OPTIONS=--no-such-flag
expect_equals "a Node.js that cannot start is refused" "$RC" 1
expect_contains "the output of the failed check is shown" "$OUT" "not allowed in NODE_OPTIONS"
expect_contains "NODE_OPTIONS is named as a suspect" "$OUT" "NODE_OPTIONS is set (--no-such-flag)"
mkdir -p "$WORK/rel/boom"
printf 'console.error("boom: the reason"); process.exit(1);\n' >"$WORK/rel/boom/valcloud.mjs"
render_installer 0.4.0 "$WORK/rel/boom/valcloud.mjs" "$WORK/install-boom.sh"
new_home
run_installer "$WORK/install-boom.sh"
expect_equals "a bundle that fails its version check is refused" "$RC" 1
expect_contains "the bundle's own output is shown" "$OUT" "boom: the reason"

# F7: hashes are read from stdin, so no file name reaches the hash line. A backslash in the install path cannot be tested through that, because Node.js cannot run a module from such a path; the installer refuses it up front.
new_home
run_installer "$INSTALL_1" "VALCLOUD_INSTALL_DIR=$H/back\\slash"
expect_equals "an install dir with a backslash is refused" "$RC" 1
expect_contains "the message says why" "$OUT" "must not contain a backslash"
check "backslash refusal: nothing was created" test ! -e "$H/back\\slash"

# F8: the runtime and bundle that the launcher names at cleanup time survive, whoever put them there.
new_home
run_installer "$INSTALL_1"
mkdir -p "$H/.valcloud/lib" "$H/.valcloud/runtime/node-v9.9.9-other-1/bin"
echo other >"$H/.valcloud/lib/valcloud-0.3.0.mjs"
echo old >"$H/.valcloud/lib/valcloud-0.0.1.mjs"
cat >"$WORK/shims-fail/basename" <<EOF
#!/bin/sh
# The first call after the launcher was written stands in for another run replacing the launcher meanwhile.
if [ ! -e "$H/swapped" ]; then
  touch "$H/swapped"
  printf '#!/bin/sh\n# managed by the valcloud installer\nexec '"'$H/.valcloud/runtime/node-v9.9.9-other-1/bin/node'"' --use-env-proxy --use-system-ca '"'$H/.valcloud/lib/valcloud-0.3.0.mjs'"' "\$@"\n' >"$H/.local/bin/valcloud"
fi
PATH=$BASE_PATH exec basename "\$@"
EOF
chmod +x "$WORK/shims-fail/basename"
RUN_PATH=$WORK/shims-fail:$BASE_PATH run_installer "$INSTALL_2"
rm -f "$WORK/shims-fail/basename"
expect_equals "the interleaved update exits 0" "$RC" 0
check "the other run's runtime and bundle survive cleanup" test -d "$H/.valcloud/runtime/node-v9.9.9-other-1" -a -f "$H/.valcloud/lib/valcloud-0.3.0.mjs"
check "an unreferenced old bundle is still removed" test ! -e "$H/.valcloud/lib/valcloud-0.0.1.mjs"

# F10: a symlinked install dir is cleaned like any other.
new_home
mkdir -p "$H/real"
ln -s "$H/real" "$H/link"
run_installer "$INSTALL_1" VALCLOUD_INSTALL_DIR="$H/link"
expect_equals "a symlinked install dir installs" "$RC" 0
mkdir "$H/real/.install.stale"
touch -t 202001010000 "$H/real/.install.stale"
run_installer "$INSTALL_2" VALCLOUD_INSTALL_DIR="$H/link"
check "a stale work dir behind the symlink is removed" test ! -e "$H/real/.install.stale"

# F11: the temp launcher is a unique name, and stale ones are cleaned.
new_home
run_installer "$INSTALL_1"
touch "$H/.local/bin/.valcloud.tmp.stale" "$H/.local/bin/.valcloud.tmp.fresh"
touch -t 202001010000 "$H/.local/bin/.valcloud.tmp.stale"
run_installer "$INSTALL_2"
check "a stale temp launcher is removed" test ! -e "$H/.local/bin/.valcloud.tmp.stale"
check "a fresh temp launcher (maybe another run) is kept" test -e "$H/.local/bin/.valcloud.tmp.fresh"

# F13: ZDOTDIR set in ~/.zshenv is found by asking zsh.
new_home
if PATH=$BASE_PATH command -v zsh >/dev/null 2>&1; then
  mkdir -p "$H/zd"
  printf 'export ZDOTDIR="%s/zd"\n' "$H" >"$H/.zshenv"
  run_installer "$INSTALL_1"
  check "the PATH line goes where zsh reads .zshrc" grep -qF 'added by the valcloud installer' "$H/zd/.zshrc"
  check "no .zshrc is created in HOME" test ! -e "$H/.zshrc"
else
  skip "ZDOTDIR from .zshenv: zsh is not installed"
fi

# F14: a failing step names itself and the fix instead of exiting silently.
new_home
cat >"$WORK/shims-fail/mv" <<EOF
#!/bin/sh
case "\$*" in *node-v*) echo "mv: simulated failure" >&2; exit 1 ;; esac
PATH=$BASE_PATH exec mv "\$@"
EOF
chmod +x "$WORK/shims-fail/mv"
RUN_PATH=$WORK/shims-fail:$BASE_PATH run_installer "$INSTALL_1"
rm -f "$WORK/shims-fail/mv"
expect_equals "a failing mv stops the install" "$RC" 1
expect_contains "the message names the step and the fix" "$OUT" "could not move the Node.js runtime into"

echo "# proxy and certificate flags"
new_home
run_installer "$INSTALL_1"
check "the launcher passes --use-env-proxy and --use-system-ca" grep -qF -- "--use-env-proxy --use-system-ca" "$H/.local/bin/valcloud"
expect_equals "node is started with exactly those flags" "$(env -i PATH="$BASE_PATH" "$H/.local/bin/valcloud" --exec-argv)" '["--use-env-proxy","--use-system-ca"]'
# A CONNECT proxy that tunnels every host to a local origin server; upstream.invalid does not resolve, so only the proxy can reach it.
cat >"$WORK/proxy.cjs" <<'EOF'
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const origin = http.createServer((request, response) => response.end(`origin ${request.headers.host} ${request.url}`));
origin.listen(0, "127.0.0.1", () => {
  const proxy = http.createServer((request, response) => response.end("plain request, not CONNECT"));
  proxy.on("connect", (request, socket, head) => {
    const upstream = net.connect(origin.address().port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  proxy.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(process.argv[2], `${proxy.address().port} ${origin.address().port}`);
  });
});
EOF
PROXY_PORTS_FILE=$WORK/proxy-ports
node "$WORK/proxy.cjs" "$PROXY_PORTS_FILE" &
PROXY_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$PROXY_PORTS_FILE" ] && break; sleep 0.5; done
read -r PROXY_PORT ORIGIN_PORT <"$PROXY_PORTS_FILE" || true
if [ -z "${PROXY_PORT:-}" ]; then
  fail "the test proxy started"
else
  expect_equals "fetch goes through HTTP_PROXY" "$(env -i PATH="$BASE_PATH" HTTP_PROXY="http://127.0.0.1:$PROXY_PORT" "$H/.local/bin/valcloud" --fetch http://upstream.invalid/path)" "origin upstream.invalid /path"
  expect_equals "NO_PROXY bypasses the proxy" "$(env -i PATH="$BASE_PATH" HTTP_PROXY="http://127.0.0.1:$PROXY_PORT" NO_PROXY=127.0.0.1 "$H/.local/bin/valcloud" --fetch "http://127.0.0.1:$ORIGIN_PORT/direct")" "origin 127.0.0.1:$ORIGIN_PORT /direct"
fi
kill "$PROXY_PID" 2>/dev/null
wait "$PROXY_PID" 2>/dev/null

echo "# macOS floor"
if [ "$(id -u)" = 0 ]; then
  skip "macOS floor: the scenario needs a non-root user"
else
  mkdir -p "$WORK/shims"
  # shellcheck disable=SC2016 # the shim's own variables must stay literal
  printf '#!/bin/sh\n[ "${1:-}" = -s ] && { echo Darwin; exit 0; }\nPATH=%s exec uname "$@"\n' "$BASE_PATH" >"$WORK/shims/uname"
  chmod +x "$WORK/shims/uname"
  for old in 12.6 13.4; do
    printf '#!/bin/sh\necho %s\n' "$old" >"$WORK/shims/sw_vers"
    chmod +x "$WORK/shims/sw_vers"
    new_home
    RUN_PATH=$WORK/shims:$BASE_PATH run_installer "$INSTALL_1"
    expect_equals "macOS $old is refused" "$RC" 1
    expect_contains "macOS $old message names the floor" "$OUT" "needs macOS 13.5 or newer"
    check "macOS $old: nothing was created" test ! -e "$H/.valcloud"
  done
fi

echo "# SIGKILL invariants"
new_home
for delay in 0.1 0.4 0.8 1.2 1.8; do
  env -i HOME="$H" PATH="$BASE_PATH" SHELL=/bin/zsh /bin/bash "$INSTALL_1" >/dev/null 2>&1 &
  pid=$!
  sleep "$delay"
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  if [ -e "$H/.local/bin/valcloud" ]; then
    expect_equals "killed after ${delay}s: the launcher is absent or works" "$(launcher_version "$H/.local/bin/valcloud")" 0.1.0
  else
    pass "killed after ${delay}s: the launcher is absent"
  fi
done
sleep 2
run_installer "$INSTALL_1"
expect_equals "a clean rerun after kills exits 0" "$RC" 0
expect_equals "and the launcher works" "$(launcher_version "$H/.local/bin/valcloud")" 0.1.0

echo "# real bundle"
BUNDLE=$ROOT/release/valcloud.mjs
if [ ! -f "$BUNDLE" ]; then
  fail "the real bundle exists" "run pnpm run build:release first ($BUNDLE is missing)"
else
  version=$(cd "$ROOT" && node -p "require('./package.json').version")
  mkdir -p "$WORK/real"
  cp "$BUNDLE" "$WORK/real/valcloud.mjs"
  render_installer "$version" "$WORK/real/valcloud.mjs" "$WORK/install-real.sh"
  new_home
  run_installer "$WORK/install-real.sh"
  expect_equals "the real bundle installs" "$RC" 0
  expect_equals "valcloud --version works without Node.js on PATH" "$(launcher_version "$H/.local/bin/valcloud")" "$version"
  expect_contains "valcloud --help runs" "$(env -i HOME="$H" PATH="$BASE_PATH" "$H/.local/bin/valcloud" --help 2>&1)" "Usage: valcloud"
  installed_bundle="$H/.valcloud/lib/valcloud-$version.mjs"
  check "the bundle carries the project license notice" grep -q '^@validationcloud/cli@' "$installed_bundle"
  check "the bundle carries a bundled package's notice (zod)" grep -Eq '^zod@[0-9.]+ \(MIT\)$' "$installed_bundle"
  check "the bundle carries the notice of a package inlined in the MCP client (ajv)" grep -Eq '^ajv@[0-9.]+ \(MIT\)$' "$installed_bundle"
  check "the bundle carries the notice of fast-uri (BSD-3-Clause)" grep -Eq '^fast-uri@[0-9.]+ \(BSD-3-Clause\)$' "$installed_bundle"
fi

finish
