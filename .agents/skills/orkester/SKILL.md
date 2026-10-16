---
name: orkester
description: Coordinate parallel work on this repository when the user invokes /orkester, $orkester, or explicitly asks for a conductor and subagents.
---

Read the repository's root AI.md. Act as the conductor: own the task breakdown, issue assignments, integration, verification and final report.

Start the requested workflow immediately. Inspect open issues and existing claims; identify independent work and actual dependencies. Continue within the user's authorized scope. If no scope is provided, select actionable unclaimed issues by priority, oldest first; do not expand an explicitly bounded task into the entire backlog.

Normally run **two active issues; three is the hard repository-wide maximum** unless the user explicitly instructs a higher limit. Count all `in-progress` issues, including other sessions and the conductor's own implementation, review, integration and verification. Agent slots, CPU/memory headroom and independent files are constraints that may reduce concurrency, not permission to raise this maximum. Reserve resources for the conductor and browser testing; do not fill all tool slots automatically. If subagent tools are unavailable, explain that and run the same issue flow sequentially.

Before every assignment, resume or integration:

1. Fetch the complete open issue queue with pagination and inspect all active claims.
2. Record each active issue number, owner and phase (implementation, review, integration or verification). Count the conductor's work too.
3. Remove this session's active/owner labels from delivered work immediately when it enters a waiting queue. Never change another session's claim. Waiting for deployment does not keep a slot active; reclaim one when verification actually begins.
4. Check that the proposed work is independent and the resulting total is at most three (normally two). If capacity is full, finish or pause something first. Register new user requests in the backlog without immediately starting them.
5. Claim the issue, re-read the queue to detect races, then start. Preserve every paused worktree and commit. On worker delivery, release the claim before assigning the worker another issue; review/integration must reclaim capacity through this same check.

Give each worker one issue, acceptance criteria, explicit file ownership, dependencies and a separate Git worktree/branch. Use a common committed baseline. Workers may share read-only dependencies only; they must not change shared node_modules or lockfiles concurrently. The conductor owns package changes, overlapping integrations and final pushes to main. Where files overlap, workers return isolated commits and the conductor resolves them deliberately; never overwrite another worker's changes.

Mark actively worked issues in-progress. Each worker handles one issue at a time and returns its commit, tests and integration notes. Workers do not push main or close issues before the conductor validates their integration. Remove active and owner labels immediately on pause or delivery into the integration queue, and on completion. An unintegrated result is not an active worker assignment.

Review and integrate commits in dependency order. Run appropriate combined checks and verify GitHub Pages deployment after pushing. Keep progress updates concise. Report completed issues and genuine outstanding work. Preserve unfinished branches/worktrees until their work is safely integrated; never discard unknown work while cleaning up.


## Practices adapted from Lunden's orkester workflow

- Fetch the complete current queue with pagination before each assignment. Recheck labels and claims immediately before starting. Sort by high/medium/low priority, then creation time; future reservations do not override a fresh queue or explicit user scope. Coordination issues labelled exactly `orkester` are not work.
- Give a session a stable `orkester: <id>` owner label when several orchestrators share this repository. Apply it together with `in-progress` only during real work, remove both on pause/closure, and never remove another session’s claim. Owner labels are metadata, not priority. If sessions cannot communicate directly, maintain one status comment in a coordination issue labelled `orkester`; record issue, agent, file/module ownership, worktree and latest checkpoint. Re-read claims after reserving to detect races; the earlier valid reservation wins.
- Group related changes to the same files under one owner and execute them sequentially. Keep assignments short; workers return after their current issue and wait for a fresh assignment instead of automatically advancing through a reserved chain. Avoid formatting or dependency changes in files another worker owns.
- In WSL, prefer worktrees on the Linux/ext4 filesystem rather than `/mnt/c`. Give browser tasks distinct ports and screenshot directories. Do not run many headless browser suites simultaneously; the conductor schedules the combined suite.
- Monitor checkpoints rather than just process liveness. Ask for a concrete progress report after roughly 30 minutes without a commit or useful result; inspect stalled browser/build processes and reduce/split work if progress remains absent. Preserve existing worktrees and commits when a worker stops; resume from them rather than rebuilding the same changes.
- Integrate and test small increments locally, then publish one verified batch after the current backlog is fully implemented and integrated. Re-fetch the complete open queue immediately before pushing; unfinished or unverified issues block publication. Ready local issues stay open with `needs-deploy` and no active/owner labels. Generate the short update summary from this batch’s delta against the previously published build, not from daily summaries. The conductor is the sole main-branch writer; do not publish individual worker deliveries.

These practices are adapted from `lunden-3d-apartment/.claude/commands/orkester.md`; game-specific rules, issue numbers and its fixed VM CPU assumptions do not apply here.
