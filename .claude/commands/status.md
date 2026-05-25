---
description: Show current project status, what's done, what's next
---

Read these files and produce a status report:
1. CLAUDE.md → section 7 (Current Module Pointer)
2. ERP_Tracker.xlsx → Modules sheet (find "Done", "In Progress", "To Do" counts)
3. git status → list uncommitted changes
4. backend/src/modules/ folder list
5. frontend/src/pages/ folder list

Output format:
- Phase: [phase name]
- Current module: [name]
- Modules done: [count] / [total in phase]
- Modules in progress: [list]
- Next module: [name]
- Uncommitted files: [count]

Then suggest the smallest next concrete action (max 1 sentence).
