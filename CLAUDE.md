# Repository instructions

Read and follow [AI.md](AI.md) before changing this repository.

Use `/orkester` to start the coordinated parallel issue workflow in [.agents/skills/orkester/SKILL.md](.agents/skills/orkester/SKILL.md), exposed through [.claude/commands/orkester.md](.claude/commands/orkester.md).


Ordinary change requests follow the shared [chat intake](.orchestra/shared/ORCHESTRA.md#turn-chat-requests-into-work): create/reuse issues and start or resume scoped work unless explicitly deferred, even after the idle watch ends. Reuse an active conductor; scoped work adds no whole-backlog run or timer.

The adapters load [.orchestra/project.md](.orchestra/project.md) and the shared
model-independent core; they contain no separate copy of the orchestration rules.
