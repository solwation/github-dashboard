# Large-board row mount investigation — 2026-10-28

Follow-up [#360](https://github.com/solwation/github-dashboard/issues/360) to the [synthetic performance investigation](performance-2026-10-28.md). This change removes per-row synchronous label-width reads when ResizeObserver is available. The observer already reports its initial size and later resizes, so label partitioning keeps the same width calculation; browsers without ResizeObserver keep the existing initial-width fallback.

## Attribution and boundary

Baseline application `683b3339397e324f142b2948f84f643edb00b858`, production Chromium, 12 repositories × 120 fictional issues, six issues per column (216 split rows or 18 combined rows). The unchanged opt-in harness wraps its three existing filter/layout cycles with CDP `Profiler.start`/`Profiler.stop` when `PERF_CPU_PROFILE=1`. The [sanitized profile summary](rendering-profile-2026-10-28.json) records frame locations and sample aggregation. Raw `scene.cpuprofile` remains a private test artifact; all fixture content is generated.

The baseline profile spans 24.304 seconds and 17,281 samples. Aggregating sample `timeDeltas` by call-frame location attributes 1,587 ms of self time to IssueRow's mounted callback (`index-o__ypyis.js`, zero-based line 9, column 64736), the largest specific application frame. That callback reads `labelsContainer.clientWidth` after inserting each row and before installing its ResizeObserver. Interleaving those reads with subsequent row insertions forces synchronous layout rather than letting the browser size the mounted rows together. Sampling identifies the callback, not exact per-statement time; the read-count regression and before/after profile test this explanation.

Other substantial frames remain: card date-metadata rendering (1,351 ms), garbage collection (1,552 ms), and browser/program work (4,089 ms). This fix does not claim to remove every large-board stall, optimize date formatting or introduce virtualization. No column limits, filters, estimate computation, requests, persistence, styles or keyboard semantics change.

## Reproduction

```bash
npm run build
PERF_INVESTIGATION=1 PERF_CPU_PROFILE=1 PERF_REVISION=$(git rev-parse HEAD) \
  E2E_DEV_PORT=5360 E2E_PREVIEW_PORT=4360 \
  npx playwright test e2e/performance-investigation.spec.ts --workers=1 \
  --grep 'large desktop' --output=/tmp/issueflow-render-profile
```

Use identical inputs, column limits and available metadata for comparison. Timings start in the page immediately before the input/click and finish after two animation frames, excluding locator/scroll setup. The profile itself adds sampling overhead; shared host load and descheduling remain limitations, so elapsed differences are observations, not a portable speed guarantee. The portable regression counts row `clientWidth` reads, verifies initial observer delivery, label overflow controls and subsequent resize delivery, and also exercises the observer-unavailable fallback.

## Comparison and limits

The after build uses the same baseline plus only the IssueRow observer change; its exact source and production bundle SHA-256 values are in the JSON. Both runs used Chromium 156.0.8078.4 without CPU throttling, the same generated inputs/metadata/limits, one browser worker and reduced motion. Initial and resized labels pass the portable browser regression with **zero synchronous row-width reads**; the no-observer fallback still reads each row once. The row-mounted callback's sampled self time falls from 1,587 ms to 0.562 ms. That removes the diagnosed synchronous sizing path; it is not a claim about total application CPU, layout reduction or interaction speed. The after profile still attributes 3,332 ms to IssueRow’s broad render function (`index-MWS9kwBE.js`, zero-based line 9, column 67602), which includes metadata/date labels and vnode construction. The ResizeObserver callback itself samples 0.248 ms (before: 2.140 ms). Rendering and browser layout still happen after observation, and the profile cannot isolate every later cost or prove that all former synchronous layout work disappeared.

In-page action-to-two-frame medians (and min–max), milliseconds:

| Action | Before | After |
| --- | --- | --- |
| filter | 927 (776–968) | 1465 (1176–2208) |
| clear filter | 992 (863–1142) | 1596 (1437–2398) |
| Cards → List | 1070 (964–1183) | 2145 (1663–2399) |
| combined | 562 (448–590) | 1345 (1149–1507) |
| split | 1184 (1111–1497) | 3410 (3118–3697) |
| List → Cards | 886 (844–995) | 2057 (1529–2126) |

Aggregate elapsed timings worsened in this comparison, including Cards filtering that does not mount rows. The host's one-minute load rose from 17.88 to 23.62 on four exposed cores, with unrelated compiler/test processes competing for CPU. The sampled cycle interval rose from 24.304 to 60.697 seconds; CDP sample and task durations include descheduling. The JSON retains main-thread/layout observations, but this environment cannot establish an overall speedup or rule out smaller costs. No repeated benchmark search was used to select a favorable run.

Both full production probes passed actual filtering, all three Cards/List and split/combined cycles, unchanged refresh completion and restoration of all 216 cards from AES-GCM storage while GitHub requests were held. The change retains the existing six-per-column limits. The cache result establishes functional independence from network completion, not physical-device performance. Card date formatting, summary computation and remaining browser work remain potential separate investigations; no broader optimization is claimed here.


## Verification

- `npm run build` passed with the changed source; the conflict-marker scan, TypeScript and production bundle passed.
- Two portable sizing browser cases passed: initial/resize observation without synchronous width reads, and the observer-unavailable fallback. The normal harness remains opt-in; `PERF_CPU_PROFILE=1` only adds a local CPU artifact when explicitly requested.
- Ten responsive cases passed: 1600×1000 and 1000×900 desktop, 390×844, 844×390 and 320×568 mobile/touch, each in light/dark themes. Each case exercised Cards and List in split and combined boards (40 states), including long labels/titles, unread movement/comments, timeout, estimated/remaining/actual time, overflow/touch geometry and keyboard controls. Main screenshots and representative full-size desktop/phone views were visually inspected: no overlap, misplaced metadata, page overflow or unexpected row height. The change adds no style, spacing, icon, colour or motion rules.
- Both identical large-desktop production probes passed filtering, mode switches, counts of mounted items and encrypted-cache restoration. No tests or fixture responses use private GitHub data.

Raw profiles, measurement stages, screenshots and geometry artifacts are preserved in the worker’s private evidence directory `/tmp/orkester-codex-20261028-render/evidence360`; this repository stores the reproducible harness and sanitized numeric summary. Those local artifacts are not represented as uploaded attachments.
