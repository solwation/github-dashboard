# Dashboard performance investigation — 2026-10-28

Investigation for [#357](https://github.com/solwation/github-dashboard/issues/357), production application revision `2ce0a734e489ea09c2537e88478ef5378ec52f29`. No application optimization was made. The strongest actionable finding is repeated per-active-issue timeline work during unchanged manual refresh. Large board updates also produced browser stalls after automation lookup/scroll overhead was excluded.

The [sanitized measurements](performance-2026-10-28.json) contain all reported medians/ranges and environment observations. The opt-in [reproduction harness](../e2e/performance-investigation.spec.ts) generates every issue; it stores no real API responses, tokens or private fixtures.

## Reproduce

```bash
npm ci
npm run build
PERF_INVESTIGATION=1 PERF_REVISION=$(git rev-parse HEAD) \
  E2E_DEV_PORT=5357 E2E_PREVIEW_PORT=4357 \
  npx playwright test e2e/performance-investigation.spec.ts --workers=1 \
  --output=/tmp/issueflow-performance
```

The normal suite skips this measurement file. Timings are not pass/fail budgets. Tests assert functional completion, issue counts, actual filtering, restored cache data and mode switching. Each case has a four-minute safety bound; source readiness can wait up to 60 seconds. An earlier 15-second functional wait was insufficient for the large fixture and was corrected, rather than classifying a slow completion as broken functionality.

## Inputs and method

- One repository × 60 issues (60 total, 20 active), and 12 repositories × 120 issues (1,440 total, 480 active). Each repository has equal Backlog/In progress/Closed populations, long titles/labels and a 276-character fictional description. Default six-per-column limits mount 18 or 216 cards/rows in split mode; combined mode mounts 18. This does not exercise unlimited rows or deep pagination beyond 100 issues in one state. Active starts are known; closed-work history, expanded details/comments and Statistics are outside this fixture, so calibrated estimate/deviation workloads are not characterized.
- Chromium 156.0.8078.4 production build, one worker, no CPU throttling, reduced motion enabled; desktop 1600×1000 and mobile/touch 390×844. The phone case is browser emulation on the same machine, not physical-phone speed.
- The machine exposed four available cores; one-minute load was roughly 16–22 during retained runs, with about 10 GiB available memory at assignment. Other sessions competed for CPU. Absolute timings and comparisons between different runs are therefore noisy. A completed exploratory large-desktop cold run took 37.1 s versus 23.7 s in the retained final run with the same valid-source fixture.
- GitHub is fully mocked with no added latency. REST responses carry stable ETags and return 304 when matched. GraphQL returns valid empty relationship/closing metadata, so missing-issue errors do not manufacture retries. Real network latency, GitHub processing, quotas and server/CDN caching are not simulated.
- UI timing starts inside the page immediately before the Vue-bound input event/native control click and ends after two animation frames. Selector lookup happens before that clock. Functional Playwright checks follow it. The JSON separately retains driver-inclusive timings, script/layout observations and long tasks. These are frame checkpoints, not physical input-to-screen measurements; host descheduling still affects them.
- Cold readiness starts at **Show overview** after fictional sign-in/repository selection; it excludes time spent entering credentials. First card is observed by an animation-frame DOM check. Cached startup starts at document navigation, with every GitHub response held until all cached cards are restored. These two clocks have different origins; do not compare them as equivalent cold/warm first-paint benchmarks.
- Three UI cycles and two unchanged manual refreshes per case. Heap samples force GC before and after the cycles. CDP node counts include detached/collectable nodes and are not a live-DOM/leak measure. Cache bytes are actual AES-GCM ciphertext bytes in IndexedDB. Raw stage JSON remains a local test artifact; the committed JSON contains only synthetic numeric observations.

## Startup, refresh, cache and memory

Cold timing is first card / all selected repositories ready. Request columns are total / per-issue timelines. Cached startup is first card from navigation / longest observed task while GitHub was held.

| Case | Cold first / ready | Cold requests / timelines | Unchanged refresh median | Timelines per refresh | Cached first / max task | Ciphertext | Heap after GC, before → after 3 cycles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small-desktop | 1.06 / 1.51 s | 44 / 20 | 0.41 s | 20 (both) | 0.80 s / 188 ms | 53 KiB | 7.4 → 8.6 MiB |
| small-phone | 0.62 / 0.95 s | 29 / 20 | 0.45 s | 20 (both) | 0.49 s / 160 ms | 53 KiB | 7.3 → 8.5 MiB |
| large-desktop | 1.55 / 23.70 s | 590 / 480 | 12.50 s | 480 (both) | 2.23 s / 1391 ms | 1103 KiB | 25.0 → 26.4 MiB |
| large-phone | 2.43 / 21.11 s | 575 / 480 | 20.02 s | 480 (both) | 1.99 s / 897 ms | 1103 KiB | 25.0 → 26.0 MiB |

All four retained cases restored the full 18/216-card board from encrypted storage while GitHub responses were held. Cache availability therefore does not depend on network completion. For this dataset, cache size scaled from about 53 KiB to 1.1 MiB; encrypted restoration still had observable main-thread tasks. This experiment does not identify decryption versus parsing versus mounting as the cause, so it does not justify removing encryption or rewriting the cache.

Heap after GC increased by about 1–1.4 MiB over three complete filter/layout cycles in both dataset sizes. Transient heap/node counts rose during mount/unmount work; the forced-GC heap samples were lower than the transient peaks. No post-GC live-node count was collected. This short experiment does **not** establish a persistent leak or prove one absent; no memory fix is proposed from these samples.

## Rendering and interaction

Median in-page action→two-frame time, milliseconds. Exact ranges and long tasks are in the JSON.

| Action | Small desktop | Small phone emulation | Large desktop | Large phone emulation |
| --- | --- | --- | --- | --- |
| filter | 125 | 92 | 1655 | 1948 |
| clear-filter | 100 | 110 | 1879 | 1932 |
| list | 117 | 95 | 1768 | 1445 |
| combined | 122 | 136 | 886 | 1482 |
| split | 140 | 127 | 2468 | 2600 |
| cards | 159 | 159 | 812 | 2583 |

The large desktop filter had a 1,157 ms observed task inside its in-page window; the Cards return reached 1,343 ms. Large split scenes carry 216 mounted cards/rows versus 18 in combined mode. Later filter/layout cycles generally made no new metadata requests; occasional batches of 12 requests returning 304 were normal background synchronization coinciding with a stage. New visible issues can request optional GraphQL metadata. The observed stalls therefore warrant a rendering/computation investigation, but this report does not attribute them to one Vue function, CSS rule or allocation path. Driver-inclusive times were sometimes much worse than the in-page intervals and must not be presented as application-only latency.

## Prioritized follow-up

### 1. Medium: avoid redundant work-start timeline reads on unchanged full refresh — [#359](https://github.com/solwation/github-dashboard/issues/359)

**Measured:** 20 timeline requests per refresh for 20 active issues; 480 per refresh for 480 active issues. In the large scene, 516 REST responses per refresh were 304: 480 timelines plus 36 open/closed/label lists. 304 saves response bytes, but still incurs scheduling/request work. The large case revalidated hundreds of timelines to redraw an unchanged board.

**Code path:** [`GitHub.lane`](../src/lib/github.ts) selects every current In progress issue and fetches its timeline, even though `previous` is supplied and the list responses are unchanged. [`startTime` / `syncLane`](../src/lib/github.ts) already reuse a known, non-error start for unchanged issue metadata. Apply equivalent safe reuse to the full-refresh path, or another explicitly bounded revalidation policy, rather than bypassing issue-list revalidation.

**Suggested acceptance:** compare this same fixture before/after; unchanged manual refresh should avoid per-issue timeline fan-out while still revalidating current issue state/labels. Changed timestamps, status/work labels or workflow-rule interpretation, unknown starts, previous timeline errors and reopened work must receive fresh history as needed. Preserve custom work-label semantics, closed-work timing, account/repository isolation and genuine errors. Include targeted transport/label/start-time checks and the same desktop/touch refresh flow. Report request counts and timing ranges; choose any time budget on controlled hardware, not from this loaded host. This is an independently useful implementation issue for the conductor to track.

### 2. Medium: profile and reduce large-board scene-update stalls — [#360](https://github.com/solwation/github-dashboard/issues/360)

**Measured:** in-page filtering and layout transitions become materially slower with 1,440 issues/216 split-scene components, including long tasks, even after locator/scroll polling is outside the timing interval. The source of the report's perceived heaviness is therefore not only GitHub request latency.

**Suggested scope/acceptance:** capture one controlled CPU/allocation profile of the retained large scene, identify the dominant application stack, then implement one supported change. Candidates to validate include repeated filtering/summary/estimate work and component mount/layout churn; they are hypotheses, not diagnosed causes. Compare identical data, column limits, layout and metadata availability before/after using the in-page clock. Keep filtered issue counts, Cards/List, split/combined, keyboard access and encrypted-cache restoration correct; add a portable regression check for the diagnosed failure mechanism. Do not select virtualization or a broad rewrite before attribution. Existing combined mode's scene of 18 components is a useful comparison, not an equivalent split-view replacement.

Cold signed-in initialization also performs 480 timeline reads; public mode already has a bounded repository-history path. Batching authenticated history may be a later optimization, but it needs an explicit completeness/fallback design for old work starts and permissions. It should not silently cap history or substitute closure time for work start. Start with the smaller unchanged-refresh improvement above.

## Verification and limits

The final production build and all four measured browser cases completed successfully across scoped runs. Repeats were limited to fixing the checkbox fixture selector, returning valid GraphQL metadata, excluding automation timing overhead and allowing slow functional readiness. No native-device performance, long-duration leak result, real network throughput or before/after improvement is claimed. No runtime/build/publication input changed; this delivery consists of the opt-in harness and report/measurement files only.
