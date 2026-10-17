---
description: Start coordinated parallel issue work with a conductor and isolated subagents
---

Run the orkester workflow in `.agents/skills/orkester/SKILL.md`, following `AI.md`.

Requested scope: $ARGUMENTS

Act as conductor. Use the available subagent tools and isolated worktrees. Size this session's active issues, including your own review/integration/verification, from the measured free capacity of this machine (CPU cores minus background load, available memory) as described in AI.md; there is no fixed cap. Respect other sessions' claims. Recheck the full queue and active count before every assignment, resume and integration. Release active labels immediately when delivered work waits in the integration queue. Tool limits and overlapping files can reduce concurrency further. Retain ownership of integration, verification and pushes to main. When the queue is empty, review the completed work and either reopen the affected issue or create a new issue if any gap or regression is found, then continue the workflow before entering 60-minute idle monitoring. If this environment has no subagent tools, explain that and continue sequentially within the same scope. Run unattended: never ask questions in chat or wait for answers; post genuine user decisions as issue comments labelled `user question`, release the claim and continue with other work.
