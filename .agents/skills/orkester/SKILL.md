---
name: orkester
description: Coordinate parallel work on this repository when the user invokes /orkester, $orkester, or explicitly asks for a conductor and subagents.
---

Read the repository's root AI.md. Act as the conductor: own the task breakdown, issue assignments, integration, verification and final report.

Start the requested workflow immediately. Inspect open issues and existing claims; identify independent work and actual dependencies. Continue within the user's authorized scope. If no scope is provided, select actionable unclaimed issues by priority, oldest first; do not expand an explicitly bounded task into the entire backlog.

Choose useful concurrency from both available agent slots and local resources (`nproc`, available memory, current workload). Reserve capacity for the conductor and verification. Use roughly three active issues as an initial working limit, then adapt to measured CPU/memory headroom, available slots and independent file ownership. Do not fill all slots automatically. Include integration and browser-test load in that budget; queued integration is paused work and must not retain in-progress. Reduce concurrency when reviews, tests or overlapping changes become the bottleneck. If subagent tools are unavailable, explain that and run the same issue flow sequentially.

Give each worker one issue, acceptance criteria, explicit file ownership, dependencies and a separate Git worktree/branch. Use a common committed baseline. Workers may share read-only dependencies only; they must not change shared node_modules or lockfiles concurrently. The conductor owns package changes, overlapping integrations and final pushes to main. Where files overlap, workers return isolated commits and the conductor resolves them deliberately; never overwrite another worker's changes.

Mark actively worked issues in-progress. Each worker handles one issue at a time and returns its commit, tests and integration notes. Workers do not push main or close issues before the conductor validates their integration. Remove the label when a worker pauses or the integrated issue is complete.

Review and integrate commits in dependency order. Run appropriate combined checks and verify GitHub Pages deployment after pushing. Keep progress updates concise. Report completed issues and genuine outstanding work. Preserve unfinished branches/worktrees until their work is safely integrated; never discard unknown work while cleaning up.


## Practices adapted from Lunden's orkester workflow

- Fetch the complete current queue with pagination before each assignment. Recheck labels and claims immediately before starting. Sort by high/medium/low priority, then creation time; future reservations do not override a fresh queue or explicit user scope. Coordination issues labelled exactly `orkester` are not work.
- Give a session a stable `orkester: <id>` owner label when several orchestrators share this repository. Apply it together with `in-progress` only during real work, remove both on pause/closure, and never remove another session’s claim. Owner labels are metadata, not priority. If sessions cannot communicate directly, maintain one status comment in a coordination issue labelled `orkester`; record issue, agent, file/module ownership, worktree and latest checkpoint. Re-read claims after reserving to detect races; the earlier valid reservation wins.
- Group related changes to the same files under one owner and execute them sequentially. Keep assignments short; workers return after their current issue and wait for a fresh assignment instead of automatically advancing through a reserved chain. Avoid formatting or dependency changes in files another worker owns.
- In WSL, prefer worktrees on the Linux/ext4 filesystem rather than `/mnt/c`. Give browser tasks distinct ports and screenshot directories. Do not run many headless browser suites simultaneously; the conductor schedules the combined suite.
- Monitor checkpoints rather than just process liveness. Ask for a concrete progress report after roughly 30 minutes without a commit or useful result; inspect stalled browser/build processes and reduce/split work if progress remains absent. Preserve existing worktrees and commits when a worker stops; resume from them rather than rebuilding the same changes.
- Integrate and publish small verified increments. Unlike Lunden’s independent-worker pushes, this repository keeps the conductor as the sole main-branch writer to avoid concurrent integration conflicts.

These practices are adapted from `lunden-3d-apartment/.claude/commands/orkester.md`; game-specific rules, issue numbers and its fixed VM CPU assumptions do not apply here.
