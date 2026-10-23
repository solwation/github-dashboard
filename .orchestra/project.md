# github-dashboard orchestra policy

Read [AI.md](../AI.md), this policy, the versioned [shared core](shared/ORCHESTRA.md),
[Issueflow authority](shared/ISSUE-WORKFLOW.md) and [queue coordination](shared/COORDINATION.md).
The shared method owns short planning, useful parallelism, risk-based verification,
evidence reuse and one integration review. This file supplies this project's settings
and overrides; explicit user instructions and platform limits take precedence.

`/orkester`, `$orkester` or a plain-language request to run orchestration invokes this
workflow. Reading, updating or installing these instructions does not start the queue.
Keep explicit user scope; without it, work the repository's startable issue backlog.
Use [the compact worker brief](shared/WORKER.md) for each assignment.

## Issueflow and queue

- Repository: `solwation/github-dashboard`; coordination issue: [#97](https://github.com/solwation/github-dashboard/issues/97).
  This project does not inherit Lunden's other queues, capacity limit or report intake.
- [public/ISSUEFLOW.md](../public/ISSUEFLOW.md) remains the canonical Issue workflow
  instructions maintained by this project. Follow its current revision under the shared
  authority procedure. Share the resolved guide/revision with workers. The imported
  offline copy never replaces or becomes a second edited source for this public guide.
- Create/reuse issues with acceptance, exactly one canonical priority and impact/urgency
  rationale under AI.md. Do not change existing priorities without user direction.
  Default missing priority to medium when ordering; high → medium → low, oldest first,
  then numeric issue number. Explicit user scope/order takes precedence.
- Fetch every open-issue page before assignment, resume and integration. Read selected
  bodies/comments and current coordination claims; exclude PRs and exact `orkester`
  coordination issues, never `orkester: <id>` ownership metadata. A partial/failed fetch
  cannot prove the queue is empty. Re-read the queue/claims after reserving to catch races;
  the earlier valid claim wins. Never seize another session's active issue.
- Use one stable `orkester: <id>` plus `in-progress` only during actual work. Maintain
  one editable status comment in #97 with issue, owner/phase, file responsibilities,
  worktree, capacity and latest checkpoint. Preserve the same identity when resuming.
- Remove all recognized work labels and this session's owner labels on pause, completion,
  reopening, or delivery into the integration queue. Reclaim capacity before review,
  integration or verification starts. Waiting for deployment consumes no active slot.
  Preserve paused commits/worktrees and never remove another active session's claim.

## Capacity, ownership and progress

Measure this machine before each assignment/resume/integration; there is no fixed
worker count. Compute `free_cores = nproc - max(0, load1 - own load)` and
`free_mem = MemAvailable - 2 GiB`; capacity is
`min(floor(free_cores / 1.5), floor(free_mem / 1.5 GiB))`, allowing at least one active
issue while startable work exists. A browser-suite worker costs 2 cores and 2 GiB.
Available tool slots and independent work may lower capacity; reserve resources for
the conductor and browsers rather than filling all slots automatically.

Count this session's active issues across workers and the conductor's implementation,
review, integration and verification. Other sessions' claims count towards their own
capacity, but their machine load and file ownership still matter. Record issue/owner/
phase before starting; finish or pause work if capacity is full. New user requests can
be filed in the backlog without starting another concurrent task. If delegation tools
are unavailable, report it and perform the same roles sequentially.

One issue per worker, with a committed common baseline and explicit file ownership in
an isolated checkout/worktree (prefer ext4 under WSL). Workers can return isolated
commits; only the conductor integrates, validates and pushes main. They neither push
main nor close issues. Shared dependencies are read-only: serialize package/lockfile
changes and overlapping integrations. Each browser task gets its own port/evidence
folder; schedule expensive browser suites instead of running them all concurrently.

Aim for a useful delivery within 30 minutes. Reassess progress around that time and
inspect stalled processes at 45–60 minutes without concrete progress. Split genuinely
independent useful outcomes when needed, not merely because a timer or file count was
crossed. Keep a small coherent issue in one delivery; helpers need not invent test/docs
child issues. Preserve interrupted work and resume its commits rather than recreating it.

## Questions and release

Follow [AI.md's Git and publication rules](../AI.md#implementation-and-git), including
its required local checks, release metadata, final Action gate and Pages verification.
The shared core does not authorize another deployment route or relax those gates.
For unpublished subtree imports preserve merge ancestry with
`git rebase --rebase-merges origin/main`; never force-push main.

Integration pushes are allowed while work remains, but main must always contain only
finished, verified work. Only Actions authorizes app publication. Both gates fetch the
complete fresh queue and bind source/main, public baseline, prepared delta and final
artifact. Active/owner/blocked claims and missing readiness stop publication; unclaimed
backlog outside the prepared delta does not. The existing three-hour fallback concerns
claims outside the delta only; it never permits unfinished code on main.

Mark integrated, verified app work `needs-deploy` without active/owner/blocked labels;
include it in the traceable prepared delta, with truthful bilingual release notes and
≤180-character update summaries against the actual public build commit. Never mark
unfinished work ready or close issues to bypass the gate. After an Action actually
publishes, verify Pages, close delivered issues and remove `needs-deploy`. Distinguish
successful publication from a successful Action whose deployment was skipped.

Instruction-only maintenance is delivered as usable checked-in instructions. Inspect
its Action outcome and report an unchanged/legitimately skipped app publication honestly;
do not invent user-facing app release notes or alter the deployment gate to publish docs.

The unattended orchestra never asks in chat or waits for routine confirmation. Decide
implementation/coordination choices, documenting material reasoning. Genuine user
questions go on the issue with concrete options and a recommendation, labelled
`user question`; release inactive claims and continue other startable work. Resume only
after an actual user answer and remove the question label. `user question` does not
block publication; reserve `blocked` for real technical blockers, which do stop the gate.

## Final review and watch

When the actionable queue is empty and the latest app batch is published and verified,
review acceptance, commits, code quality, test evidence and live behavior that has not
yet been reviewed in its final state. Reuse valid final-state evidence; do not blindly
repeat green tests. Reopen an affected issue (clearing stale work/`needs-deploy` labels)
or create a scoped priority-assessed issue for actual defects/gaps, then continue work.

Only after the final work is solved, published, verified and reviewed without findings,
start the 60-minute idle watch. This project-specific trigger overrides the shared
core's simpler last-resolution default. Poll the complete paginated queue about every
60 seconds, with interruptible waits ≤60 seconds. New user input steers the active task;
new or review-triggered work resumes ordinary scope/priority/claim/capacity checks.
Reset the full hour after the next completed, published, verified and reviewed batch.

Keep no active claims while idle; create no scheduled jobs or external messages.
Record UTC last attempt/outcome, last successful complete queue check, release/review
time and watch deadline in private checkpoint/#97. Failed reads do not overwrite
successful times or prove an empty queue. Finish after the hour and a successful final
complete queue check without startable work, or promptly on explicit user stop/pause.
Report real remaining blockers; do not close unfinished work.

## Shared version

Imported as `.orchestra/shared` with Git subtree `--squash`: **v0.1.0**,
commit **67507ef71c4979d8340e03e84072719651ada7df** from
[dirigenten-och-orkestern](https://github.com/solwation/dirigenten-och-orkestern).
Follow its [update/contribution guide](shared/README.md). Keep project policy outside
the subtree, improve generic behavior in the shared repository, and explicitly adopt
reviewed releases here. Do not subtree-push this project's files/history upstream.
