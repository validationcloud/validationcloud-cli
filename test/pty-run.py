"""Run a command with a pseudo-terminal on stdin and stderr, answer its prompt, and print a JSON report.

Node cannot allocate a pseudo-terminal without a native addon, so the prompt-path integration test uses this
standard-library helper. Usage: pty-run.py <y|n|eof|interrupt> <command> [argument ...]
"""

import fcntl
import json
import os
import select
import subprocess
import sys
import termios
import time

PROMPT = b"[y/N]"
TIMEOUT_SECONDS = 20
ANSWERS = {"y": b"y\n", "n": b"n\n", "eof": b"\x04", "interrupt": b"\x03"}


def read_available(fd: int) -> bytes:
    try:
        return os.read(fd, 4096)
    except OSError:
        return b""


def main() -> None:
    answer = ANSWERS[sys.argv[1]]
    master, slave = os.openpty()
    child = subprocess.Popen(
        sys.argv[2:],
        stdin=slave,
        stdout=subprocess.PIPE,
        stderr=slave,
        start_new_session=True,
        preexec_fn=lambda: fcntl.ioctl(0, termios.TIOCSCTTY, 0),
    )
    os.close(slave)
    assert child.stdout is not None
    stdout_fd = child.stdout.fileno()
    terminal = b""
    stdout = b""
    answered = False
    open_fds = {master, stdout_fd}
    deadline = time.monotonic() + TIMEOUT_SECONDS
    timed_out = False

    while open_fds and time.monotonic() < deadline:
        ready, _, _ = select.select(list(open_fds), [], [], 0.1)
        for fd in ready:
            data = read_available(fd)
            if not data:
                open_fds.discard(fd)
            elif fd == master:
                terminal += data
            else:
                stdout += data
        if not answered and PROMPT in terminal:
            os.write(master, answer)
            answered = True
    else:
        timed_out = bool(open_fds)

    if timed_out:
        child.kill()
    exit_code = child.wait()
    os.close(master)
    print(
        json.dumps(
            {
                "exitCode": exit_code,
                "timedOut": timed_out,
                "stdout": stdout.decode(),
                "terminal": terminal.decode(),
            }
        )
    )


main()
