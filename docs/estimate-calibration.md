# Historical estimate audit, 2026-10-28 (#351)

The local text heuristic now returns 1–3 points. Explicit point labels retain every
supported positive safe integer. Repository timing still uses up to 30 closures in
30 days, at least three usable observations, median duration per point and the
existing 4× interruption filter. This changes the relative influence of text sizes,
not a fixed number of minutes per point.

The audit read all 5,444 issues across six authorized repositories (including the
two newly created follow-up issues). 3,512 closed, non-coordination issues had a
usable recorded work start; 3,489 could be compared using a common historical
basis for every candidate. Raw issue content was held in memory only.

For each target, calibration includes only issues closed **before its work start**,
in the preceding 30 days, capped at the most recent 30. Each repository's oldest
70% of eligible predictions forms the development segment; the latest 30% forms
the comparison segment. These are historical replays with current title/body and
point labels, **not stored original forecasts**. Titles, descriptions and labels
may have changed since work began. Alternative models were explored in the same
audit, so this comparison is not independent prospective validation.

The pooled development segment has 2,439 predictions; the comparison segment has
1,050. Success means estimated duration is between half and twice recorded elapsed
duration, inclusive. Counts are pooled by issue, so the busiest repositories have
more influence. The CLI also reports every repository separately.

| Candidate | Development within factor 2 | Comparison within factor 2 |
| --- | ---: | ---: |
| Previous 1/2/3/5/8/13 heuristic | 1,335 (54.7%) | 513 (48.9%) |
| Ignore size entirely | 1,387 (56.9%) | 538 (51.2%) |
| Square root of local size (fractional research candidate) | 1,408 (57.7%) | 558 (53.1%) |
| **Cap local size at 3; preserve explicit labels** | **1,392 (57.1%)** | **560 (53.3%)** |
| Cap local size at 5 | 1,381 (56.6%) | 549 (52.3%) |
| Compressed integer scale 1/2/2/3/3/5 | 1,398 (57.3%) | 557 (53.0%) |
| Compressed integer scale 1/1/2/2/3/5 | 1,356 (55.6%) | 542 (51.6%) |
| Previous size, latest 10 closures | 1,361 (55.8%) | 505 (48.1%) |
| Cap local size at 3, latest 10 closures | 1,366 (56.0%) | 549 (52.3%) |
| Previous size, omit extreme-duration filter | 1,348 (55.3%) | 535 (51.0%) |
| Cap local size at 3, omit extreme-duration filter | 1,407 (57.7%) | 567 (54.0%) |

Capping local size at 3 is a simple integer alternative close to the fractional
compression candidate, with straightforward migration of encrypted statistics:
`min(previous local score, 3)`, preserving explicit point labels. In the dashboard
repository's comparison segment, its median multiplicative error decreased from
2.707 to 2.354, with 28/69 rather than 26/69 predictions within factor 2. The small
orchestration repository regressed (3/6 rather than 4/6 within factor 2), so this
is not a claim of improvement for every repository or every task.

Omitting the interruption filter improved the pooled success count slightly more,
but also admits suspected abandoned work into concurrency and calibration. That
tradeoff was not adopted. Shortening the history had inconsistent results.

## Reproduce

Use an authenticated GitHub CLI and a checkout containing the baseline commit:

```sh
git fetch origin main
ESTIMATE_AUDIT_BASELINE_REF=a0a2d3ae151ab097161767c90dcf89731b813396 \
  node scripts/audit-estimates.mjs owner/repository another/repository
```

The script paginates both issues and their work-label/closure/reopening timelines.
It reads raw content in memory and prints aggregate JSON per repository; progress
goes to stderr. No repository fixtures or credentials are written. The baseline
point scorer is loaded from the specified Git revision so results do not silently
switch to the new heuristic. Counts can change as GitHub issues change.

## Limits of elapsed time and liveness

The recorded duration runs from the last known work period's start to closure,
using the dashboard's existing event semantics. It is not a timesheet: pauses,
verification, release waits and unattended agents can affect it. It does not sum
previous paused work periods. Unknown starts are excluded rather than replaced
with issue creation time. Current explicit labels cannot establish the original
human estimate or when that estimate was agreed.

Orchestra asks for visible status updates and investigation after 45–60 minutes
without concrete progress; it does not mandate a fixed per-issue heartbeat in this
project. Other projects can have their own claim expiry (one inspected policy uses
90 minutes). Missing heartbeat is a prompt to investigate, not proof of death or
permission to seize a claim.

The separate inactivity indicator (#352) uses a known current work start and the
last visible issue update. It never declares an agent offline and never rewrites
issue state, expires ownership or retroactively deletes timing samples. A fresh
metadata change is not proof of progress, and work or coordination-thread updates
can occur without updating the issue itself.
