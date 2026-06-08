# ISC-45 Falsification Probe — Mini2 Manual Variant

> Companion to `infra/probe-pty-survival.sh` (the in-process local probe). This
> document describes the **end-to-end mini2** version: phone Safari →
> headless maestro server on mini2 → `kill -9` → launchd restart → phone
> reload → assert scrollback intact.
>
> The in-process probe validates the persistence layer in isolation (disk
> round-trips work). This document validates the full integration path that
> the user actually experiences. Both probes share the same on-disk format
> (`<dataDir>/pty-scrollback/<sessionId>.{log,seq,meta}`). If the local
> probe passes but this manual probe fails, the disk format is correct and
> the bug is in the wiring (WS dispatch, session-id resolution,
> client-side `lastSeq` persistence). If both fail, the disk layer itself
> is broken.

---

## ISC-45 verbatim (from `ISA.md`)

> Antecedent: Layer 0c has landed and the headless server can spawn pty
> sessions from the browser. Probe: spawn a pty session from phone Safari
> against the mini2 server; send a command into it; observe output;
> `kill -9` the server process on mini2; restart the server (via launchd
> or `./infra/deploy.sh`); reload the phone tab; the SAME pty re-attaches
> with intact scrollback (the command and its output are still on-screen).
> If the pty does NOT survive — fresh terminal, no scrollback — the entire
> decouple-from-Electron investment delivered nothing the user can feel,
> and the project's value claim collapses regardless of which lower-numbered
> ISCs are green.

---

## Preconditions

- Mini2 reachable on the tailnet; `tailscale ping mini2` < 50 ms from the
  phone's connection.
- `com.maestro.server` launchd agent installed and `KeepAlive` enabled
  (per `infra/com.maestro.server.plist`). After `kill -9`, launchd should
  auto-restart the server within ~2 s.
- Phone Safari has a saved bookmark to
  `http://mini2.<tailnet>.ts.net:<port>/<token>/`.
- A terminal session exists on the server (open one from the laptop first
  if needed).
- The server is built from a commit that includes L6.3 disk-backed
  scrollback (boot log line mentions "disk-backed scrollback").

## Probe steps

1. **Phone Safari**: open the maestro URL. Navigate to a terminal session.
   xterm renders the prompt.
2. **Phone Safari**: type a command that produces distinctive output that
   would NOT appear on a fresh shell. Suggested:
   ```
   echo "PROBE_MARKER_$(date +%s) — scrollback survival test"
   uname -a
   ls /etc | head -5
   ```
   Wait for output to render. Take a screenshot for evidence.
3. **SSH to mini2** (from laptop):
   ```bash
   ssh mini2
   pgrep -f 'dist/server/index.js' | head -1
   # capture PID, e.g. 12345
   sudo kill -9 12345
   ```
4. **Wait** for launchd to restart the process. Verify:
   ```bash
   sleep 3
   pgrep -f 'dist/server/index.js' | head -1
   # should print a DIFFERENT PID
   ```
5. **Phone Safari**: pull-to-refresh the tab (or close + reopen the
   bookmark).
6. **Observe**: the xterm should re-render with the pre-kill command
   output still visible above the new prompt. The screenshot from step 2
   should match the current view (modulo any new prompt at the bottom).

## Pass criteria

PASS if **all** of the following hold:

- The xterm renders with the `PROBE_MARKER_<timestamp>` line visible
  without scrolling.
- The `uname -a` output is visible.
- The `ls /etc | head -5` output is visible.
- The user can immediately type another command and have it execute —
  i.e. the PTY is alive and stdin is wired (this also validates ISC-13
  which says "reopening the URL re-attaches to the same pty").

## Fail modes (each falsifies ISC-45)

- **Fresh prompt, no history**: xterm renders only a new shell prompt.
  Disk persistence didn't survive `kill -9` OR the client isn't sending
  `lastSeq` OR the server isn't reading it back. Inspect:
  ```bash
  ssh mini2
  ls -la ~/.config/maestro/pty-scrollback/
  # should show <sessionId>-terminal.log etc. with non-zero size
  cat ~/.config/maestro/pty-scrollback/*.meta
  # should show {"startSeq": ..., "startOffset": ...}
  ```
- **"Connection lost" banner**: server didn't restart. Inspect:
  ```bash
  ssh mini2
  launchctl print gui/$(id -u)/com.maestro.server
  log show --predicate 'process == "com.maestro.server"' --last 5m
  ```
- **Partial scrollback** (some commands missing): rotation kicked in
  mid-write. The disk hard cap is 8 MB; a long-running terminal could
  hit it. Verify the markers are within the surviving window — if they
  were among the rotated-out entries, this is expected behavior (not
  a falsification), and the probe should re-run with a shorter test
  window.

## Filing the evidence

After running the probe:

- Pass: append a Verification entry to the project `ISA.md` referencing
  this document, the two screenshots, and the date of the run. Flip
  ISC-45 to closed.
- Fail: append a Decisions entry to the project `ISA.md` documenting
  the failure mode, the on-disk inspection output, and the next probe
  to run. Do NOT close ISC-45.

## Relationship to the local probe

The local probe `infra/probe-pty-survival.sh` exercises the
`RawPtyMultiplexer` disk layer in isolation. It is the persistence-layer
unit test of the falsification claim. It runs on any host with `node`
and a built `dist/`, in under 5 seconds.

The mini2 probe documented above exercises the full integration. It
requires network reachability, launchd configuration, a real PTY, a
real browser, and a human in the loop.

Running the local probe first and only resorting to the mini2 probe
when the local one passes saves cycles. A local PASS + mini2 FAIL
isolates the bug to the integration path; both PASS confirms end-to-end
parity.
