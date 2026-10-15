---
name: orkester
description: Coordinate parallel work on this repository when the user invokes /orkester, $orkester, or explicitly asks for a conductor and subagents.
---

Read the repository's root AI.md. Act as the conductor: own the task breakdown, issue assignments, integration, verification and final report.

Start the requested workflow immediately. Inspect open issues and existing claims; identify independent work and actual dependencies. Continue within the user's authorized scope. If no scope is provided, select actionable unclaimed issues by priority, oldest first; do not expand an explicitly bounded task into the entire backlog.

Choose useful concurrency from both available agent slots and local resources (`nproc`, available memory, current workload). Reserve capacity for the conductor and verification. Start small, grow only while work remains independent, and avoid a worker per CPU thread when memory, tooling limits or coordination overhead make that inefficient. If subagent tools are unavailable, explain that and run the same issue flow sequentially.

Give each worker one issue, acceptance criteria, explicit file ownership, dependencies and a separate Git worktree/branch. Use a common committed baseline. Workers may share read-only dependencies only; they must not change shared node_modules or lockfiles concurrently. The conductor owns package changes, overlapping integrations and final pushes to main. Where files overlap, workers return isolated commits and the conductor resolves them deliberately; never overwrite another worker's changes.

Mark actively worked issues in-progress. Each worker handles one issue at a time and returns its commit, tests and integration notes. Workers do not push main or close issues before the conductor validates their integration. Remove the label when a worker pauses or the integrated issue is complete.

Review and integrate commits in dependency order. Run appropriate combined checks and verify GitHub Pages deployment after pushing. Keep progress updates concise. Report completed issues and genuine outstanding work. Preserve unfinished branches/worktrees until their work is safely integrated; never discard unknown work while cleaning up.
