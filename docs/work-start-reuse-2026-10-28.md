# Full-refresh work-start reuse — 2026-10-28

Delivery for [#359](https://github.com/solwation/github-dashboard/issues/359), following the [synthetic investigation #357](performance-2026-10-28.md). Authenticated full refresh still revalidates the open/closed issue lists and repository labels. It now shares the existing per-issue `startTime` enrichment path with incremental updates, reusing a valid known start when the same authenticated client has already resolved that exact issue version under the same work-label interpretation.

## Reuse boundary

Evidence lives in a client-local WeakMap keyed by the enriched issue object. It records repository identity, normalized work-rule interpretation, issue id/number/state/closure/update timestamp, label names and the resolved start. Both the old shown object and the fresh list object must match that evidence; starts must be finite, non-future and free of a previous timeline error. Returned objects are enriched copies, so raw ETag response data remains unmodified. Old board objects can be collected; evidence is never serialized with credentials, content or response caches.

Changed metadata or work-label rules, newly active/reopened work, unknown starts, failed history, another repository/client and cloned encrypted restores all fetch history again. Unrelated priority rules do not invalidate the interpretation. A current-client incremental result can supply evidence for full refresh and vice versa. Public mode retains its existing bounded repository-event path; cold authenticated history remains fully paginated with the existing concurrency limit. Closing work-start carry remains unchanged.

## Verification and comparison method

The interrupted original #359 implementation was preserved and reviewed, then resumed in an isolated checkout based on `3e33f84`. No runtime correction was needed. Two additional regression cases cover removal/readdition of a work label without a timestamp change and malformed unchanged update timestamps; the existing timeline-error check now requires explicit `null` from the shared enrichment helper.

`npx vitest run tests/github-work-start-reuse.test.ts tests/github.test.ts tests/github-sync.test.ts tests/work-start.test.ts tests/model.test.ts tests/public-workspace.test.ts` passed **53 tests in six files**. These cover list/ETag revalidation, shared incremental/full reuse, invalidation, custom labels, errors, account/repository isolation, restored copies, closing/reopening and the public bounded-history path. `npm run build` passed the conflict-marker scan, types and production build.

The opt-in #357 production harness runs unchanged with one worker and ports 5359/4359. It generates the same small (one repository × 60 issues, 20 active) and large (12 × 120 issues, 480 active) datasets, six-per-column limits, zero mocked API latency and valid optional metadata, at 1600×1000 desktop and 390×844 mobile/touch. It exercises filtering and Cards/List, split/combined changes before two unchanged manual refreshes, then holds GitHub responses until the full encrypted board restores. No real API responses or credentials are fixtures.

The before measurements are reused from the committed #357 report at application `2ce0a734e489ea09c2537e88478ef5378ec52f29`; after is `3e33f84` plus this transport patch. The same inputs, layout, metadata and harness are used. The intervening #360 row-observer change is present after, and shared host CPU contention varies, so elapsed timing is an observation of these revisions, not an isolated/native-device speed claim. Request counts directly test the diagnosed redundant timeline work. Raw local measurements remain private artifacts; the adjacent JSON stores sanitized comparison numbers and exact source/bundle hashes.

The initial comparison attempt passed both small cases, then the large desktop reached its 240-second overall case bound during the first manual refresh after completing all three filter/layout cycles. The following large-phone case was deliberately interrupted during startup to avoid repeating an insufficient overall bound. The timeout/partial artifacts are preserved, not reported as completed measurements. Only the opt-in per-case safety bound was raised to eight minutes for one retained large-desktop/touch rerun; the 60-second functional readiness assertions and measurement clocks were kept unchanged. This is an environmental rerun reason, not evidence of a timeline-lookup failure or a favorable-timing selection.


## Retained results

[Sanitized comparison data](work-start-reuse-2026-10-28.json). Each case has two unchanged manual refresh samples. Times are median (min–max), seconds, using the harness’s driver-inclusive completion clock.

| Case | Timelines per refresh, before → after | Before seconds | After seconds | Lists revalidated on every after refresh |
| --- | --- | --- | --- | --- |
| small-desktop | 20 → 0 | 0.41 (0.36–0.45) | 0.60 (0.55–0.64) | 1 open + 1 closed + 1 labels |
| small-phone | 20 → 0 | 0.45 (0.39–0.51) | 0.98 (0.77–1.20) | 1 open + 1 closed + 1 labels |
| large-desktop | 480 → 0 | 12.50 (11.64–13.35) | 31.10 (20.43–41.77) | 12 open + 12 closed + 12 labels |
| large-phone | 480 → 0 | 20.02 (13.61–26.44) | 12.24 (8.91–15.58) | 12 open + 12 closed + 12 labels |

Both refreshes in every retained case made zero per-issue timeline requests. Cold loads still made 20/480 timeline requests, establishing fresh evidence rather than shortening or truncating history. Counts of open/closed/label list requests stayed 1/1/1 for small and 12/12/12 for large scenes; totals also include variable optional GraphQL/background-sync traffic, retained in the JSON.

All four cases passed actual filtering and the existing three Cards/List, split/combined cycles. Encrypted restoration recovered all 18/216 mounted cards while GitHub was held. The small and large phone cases use mobile/touch Chromium contexts on the same host; they establish correctness in emulation, not native-phone speed.

Elapsed results were mixed: large-phone completion was lower, while the other three cases were higher, despite removal of the diagnosed redundant requests. Original one-minute loads were roughly 16–22, versus 22–29 at the ends of the retained after cases and a peak above 35 during the interrupted attempt. Metadata/render work and scheduling remain part of refresh completion. The before application also predates the separate #360 row-sizing change. These observations do not establish overall latency improvement or regression caused by this transport patch; the accepted improvement is conservative removal of 20/480 redundant timeline revalidations per unchanged refresh.

Private evidence: `/tmp/orkester-codex-20261028-render/evidence359/after` contains the retained small cases and initial failure/interruption artifacts; `after-large` contains the single retained large rerun. No screenshots or full private issue responses are needed for this transport-only change. Integration, release metadata and post-publication checks remain the conductor’s responsibility.
