---
description: Start coordinated parallel issue work with a conductor and isolated subagents
---

Run the orkester workflow in `.agents/skills/orkester/SKILL.md`, following `AI.md`.

Requested scope: $ARGUMENTS

Act as conductor. Use the available subagent tools and isolated worktrees. Keep at most three active issues for this orkester session, including your own review/integration/verification; other sessions have their own limits but their claims must be respected. Only explicit user instruction can raise it. Recheck the full queue and active count before every assignment, resume and integration. Release active labels immediately when delivered work waits in the integration queue. CPU/memory and tool limits can reduce concurrency, not increase this maximum. Retain ownership of integration, verification and pushes to main. If this environment has no subagent tools, explain that and continue sequentially within the same scope. Run unattended: never ask questions in chat or wait for answers; post genuine user decisions as issue comments labelled `user question`, release the claim and continue with other work.
