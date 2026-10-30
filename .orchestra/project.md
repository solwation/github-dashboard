# github-dashboard orchestra policy

Read [AI.md](../AI.md), this policy, the versioned [shared core](shared/ORCHESTRA.md),
[Issueflow authority](shared/ISSUE-WORKFLOW.md) and [queue coordination](shared/COORDINATION.md).
The shared method owns short planning, useful parallelism, risk-based verification,
evidence reuse and one integration review. This file supplies this project's settings
and overrides; explicit user instructions and platform limits take precedence.

`/orkester`, `$orkester` or a plain-language request to run orchestration invokes this
workflow. Reading, updating or installing these instructions does not start the queue.
Keep explicit user scope. Without it this project overrides the shared core's
[bounded pass](shared/COORDINATION.md#run-a-bounded-pass): work the repository's startable
issue backlog as a queue session, then run the [final review and watch](#final-review-and-watch).
As in a pass, never ask in the chat; user-only decisions use the `user question` label,
and only the Actions gate publishes ([release](#questions-and-release)).
Use [the compact worker brief](shared/WORKER.md) for each assignment, including the
applicable [phase hooks](#project-phase-hooks) and the
[resource choice](shared/ORCHESTRA.md#spend-resources-deliberately) for the worker.

## Issueflow and queue

- Repository: `solwation/github-dashboard`; coordination issue: [#97](https://github.com/solwation/github-dashboard/issues/97).
  This project does not inherit Lunden's other queues, capacity limit or report intake.
- [public/ISSUEFLOW.md](../public/ISSUEFLOW.md) remains the canonical Issue workflow
  instructions maintained by this project. Follow its current revision under the shared
  authority procedure. Share the resolved guide/revision with workers. The imported
  offline copy never replaces or becomes a second edited source for this public guide.
  Parent issues follow its sub-issue rule: a worker starting the first sub-issue also marks
  the parent `in-progress`; the conductor removes the parent's label when no sub-issue or
  parent work remains active, and closes the parent only after its own acceptance.
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
changes and overlapping integrations. The conductor's own implementation takes a slot;
choose it deliberately (very small changes or unavailable delegation) and record why.

Every writing agent, including the implementing conductor, works only in its own
worktree under the shared [isolation rules](shared/ORCHESTRA.md#choose-the-smallest-useful-team);
never edit or run state-changing git commands in another checkout, and remove a worktree
only after integration or preservation. Give each worktree its own ports with
`E2E_DEV_PORT`/`E2E_PREVIEW_PORT` (for example 5xxx/4xxx by issue number) and its own
evidence/build paths. `playwright.config.ts` starts servers on those ports with
`--strictPort` and never reuses an existing server unless `E2E_REUSE_SERVER=1`, so a
busy port fails instead of testing another checkout. Fast checks run in parallel;
expensive browser suites are a queued shared resource taken in turns, so their cost
does not set the worker count. Report active workers, capacity and why a slot is unused.

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

Stories follow **Backlog → In progress → Closed**. After integration on main and
required local verification/review, post completion evidence and close the story
immediately, removing active/owner/blocked labels. Publication does not delay closure
or return finished work to Backlog. For app changes, keep `needs-deploy` only as
technical metadata on the closed issue and include it in the traceable prepared delta,
with truthful bilingual release notes and ≤180-character update summaries against the
actual public build commit. Never mark unfinished work ready or close it to bypass the
gate. Track pending publication in this session's status. After an Action actually
publishes, verify Pages, append publication evidence and remove `needs-deploy`; keep
the story closed unless acceptance is actually unmet. Distinguish successful
publication from a successful Action whose deployment was skipped.

Instruction-only maintenance and other [technical changes](../AI.md#implementation-and-git)
(no build or publication inputs touched) are delivered as usable checked-in files after a
local `npm run build`. Do not wait for, poll or inspect their Action run; the next app
delivery's Action check covers it. Do not invent user-facing app release notes or alter
the deployment gate to publish docs.

The unattended orchestra never asks in chat or waits for routine confirmation. Decide
implementation/coordination choices, documenting material reasoning. Genuine user
questions go on the issue with concrete options and a recommendation, labelled
`user question`; release inactive claims and continue other startable work. Resume only
after an actual user answer and remove the question label. `user question` does not
block publication; reserve `blocked` for real technical blockers, which do stop the gate.

## Project phase hooks

Apply [the shared hook contract](shared/ORCHESTRA.md#apply-project-hooks-at-each-phase).
These are agent instructions, not a hook runner. They restate where this project's
existing rules apply; [AI.md](../AI.md) and the sections above remain the detailed
source. The conductor owns every hook unless the short plan names a worker for a scoped
activity, and checks outcomes at each phase boundary. All hooks are required when
triggered; a false trigger is noted briefly where it changes expected evidence (for
example "instruction-only: no screenshots, release notes or `needs-deploy`").
Listed order is execution order.

| Hook | Phase and trigger/timing | Procedure | Requirement and completion evidence |
| --- | --- | --- | --- |
| Issue and priority | `planning`: every change, entry | Create/reuse an issue with acceptance, one canonical priority and impact/urgency rationale ([AI.md](../AI.md#issues-and-priority)); never change an existing priority without user direction | Issue linked in the plan before implementation |
| Read context | `planning`: every change, before the plan is final | Use `rg` for relevant code and instructions; read the AI.md project rules the change touches (optional-data visibility, encrypted storage, accessibility, mobile layouts) | Plan names the 2–3 risk-based checks, UI matrix need and follow-up destination |
| Isolated checkout | `implementation`: every assignment, entry | Committed common baseline, own worktree (ext4 under WSL), explicit file ownership, own `E2E_DEV_PORT`/`E2E_PREVIEW_PORT` and evidence folder ([capacity](#capacity-ownership-and-progress)) | Worktree and owned files recorded in the #97 status |
| Preserve and resolve | `implementation`: every change, exit | Preserve others' work; resolve conflicts completely, including Vue template markers; serialize package/lockfile changes | No unrelated edits or conflict markers; out-of-scope findings filed as issues |
| Release notes | `implementation`: published user-facing changes, exit | Update the day's bilingual entry in `src/release-notes.json` ([AI.md](../AI.md#project-and-verification)); run `npx vitest run tests/release-notes.test.ts` | Entry in the same commit; none for instruction-only work |
| README | `implementation`: behavior or setup changes, exit | Update `README.md`; update AI.md when the workflow changes | Docs match the delivered behavior |
| Targeted tests | `verification`: every code change | `npx vitest run <affected>` / `npx playwright test <affected>`; no routine full suite | Revision-bound results; untested behavior is never claimed |
| UI matrix | `verification`: changes affecting issue cards or list rows | Playwright Cards and List at 1600×1000, 1000×900, mobile 390×844 and 844×390 (plus 320×568 for density/truncation), relevant states, one reused public-data snapshot | Screenshots inspected for overlap, overflow and row height; no real issue fixtures committed |
| Design rules | `verification`/`review`: every UI change | Check new and changed UI against [DESIGN.md](../DESIGN.md): spacing/icon tokens, row alignment, theme tokens in both themes, accessible icon controls, reduced motion; run its checklist | Checklist outcome and alignment measurements (±1px) in the evidence; deviations fixed or filed |
| Build | `verification`: every change, before review | `npm run build` (conflict-marker scan, types, production output) | Green build at the reviewed revision |
| Integration review | `review`: every change, before delivery | Conductor reads the combined diff and evidence, inspects screenshots against acceptance, rechecks conflict markers | Defects corrected and affected checks refreshed |
| Integrate main | `delivery`: every completed change | Fetch, rebase own commits (`--rebase-merges` for subtree imports), push `main` without force; only finished, verified work | Delivered commit on `origin/main` |
| Prepare publication | `delivery`: app changes, after integration | Keep `needs-deploy` as technical metadata on the completed, closed story without active/owner/blocked labels; update `src/update-summary.json` against the public baseline ([release](#questions-and-release)) | Traceable prepared delta and separate publication status; never bypass the Actions gate |
| Check Action | `delivery`: every push to `main` that includes an app change (skip for technical changes) | Inspect the Build and deploy Pages run; distinguish a publication from a legitimately skipped deploy | Actual run outcome linked |
| Complete issue | `delivery`/`follow-up`: every tracked change, after verified integration and before closure | Post [completion evidence](shared/ORCHESTRA.md#follow-up-with-evidence-that-fits-the-change) with outcome, revision, local checks, evidence and limits; close immediately. Follow publication separately and append Pages evidence/remove `needs-deploy` after publication | Story is Closed without work/owner labels; unfinished acceptance stays open. Publication wait never moves a completed story to Backlog |

## Queue intake hooks

None configured, so the core's dispatch-before-intake rule has nothing to schedule.
Queue sessions follow [COORDINATION.md](shared/COORDINATION.md) with the complete
paginated open-issue fetch described [above](#issueflow-and-queue).

## Final review and watch

This is the project's configuration of the core
[session review](shared/COORDINATION.md#review-the-session); it replaces rather than
adds to it. Run it when the actionable queue is empty and the latest app batch is
published and verified (technical-only batches: once pushed, without waiting for their
Action). Besides the core areas, review acceptance, commits, code quality, test
evidence and live Pages behavior that has not yet been reviewed in its final state.
Reuse valid final-state evidence; do not blindly repeat green tests. Reopen an affected
issue (clearing stale work/`needs-deploy` labels) or create a scoped priority-assessed
issue for actual defects/gaps, then continue work.

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

## Shared version and maintenance

Imported as `.orchestra/shared` with Git subtree `--squash`: **v0.6.1**,
commit **432e1879416a91215b4e174699c7af705fd0359d** from
[dirigenten-och-orkestern](https://github.com/solwation/dirigenten-och-orkestern).
Follow its [installation/update guide](shared/INSTALL.md) and [contribution guide](shared/CONTRIBUTING.md). Keep project policy outside
the subtree, improve generic behavior in the shared repository, and adopt
reviewed stable releases here under the standing authorization below.
Do not subtree-push this project's files/history upstream.
The subtree also carries the shared repository's own maintainer files (`AGENTS.md`,
`AI.md`, `CONTRIBUTING.md`, `docs/`) and its example adapter
(`.claude/commands/orkester.md`); they govern upstream maintenance only, not this
project, whose own adapters stay at the repository root.

### Upstream update discovery

At conductor startup/resume, apply the core
[update-discovery procedure](shared/INSTALL.md#check-for-upstream-updates): check stable
releases **and version tags** of the official upstream
`solwation/dirigenten-och-orkestern` against the pin above. Reuse a successful check
for the same upstream/pin for up to 24 hours; an explicit update request or suspected
orchestra bug requires a fresh check. The conductor owns this check; workers and queue
polls do not repeat it. Ignore drafts/prereleases, compare version numbers, and read
changelogs plus the full instruction diff at exact resolved commits.

Standing user authorization (2026-10-28, [#356](https://github.com/solwation/github-dashboard/issues/356)):
automatically adopt newly detected stable orchestra versions from the official upstream,
without asking for approval again or adding `user question` just for the upgrade.
This overrides the shared core's proposal-only/optional-adoption default. The existing
startup/resume discovery cadence remains; no background scheduler is installed.

Create or reuse an ordinary tracked upgrade issue with installed/target versions and
exact SHAs, source links, applicability, host-policy effects, checks and next action,
prioritized under AI.md. Review the full diff including skipped versions, perform any
needed migration while preserving this project's overrides, import the exact reviewed
commit through the squashed subtree update procedure, update the host pin and README,
and complete local build, integration review and technical delivery. Do not interrupt
active work or start unrelated queue work merely to update the instructions. A newer
stable version needs no additional user decision; any real technical blocker remains
tracked with the installed pin retained until it can be resolved. Reuse existing upgrade
issues and honor any later explicit user deferral. Drafts, prereleases and unreleased
main commits are not automatic update targets.

Record UTC check time, upstream/pin, examined targets and outcome in private state or
the #97 status. If the read fails or is incomplete, keep the pin, disclose it once,
retry on the next session/resume and continue independent work; never cache failure
as success. No background scheduler is installed.
