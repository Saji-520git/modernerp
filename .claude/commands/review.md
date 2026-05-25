---
description: Review current changes against project conventions
---

Run a self-review of the current uncommitted changes.

Check each item:
- [ ] Naming: kebab-case files, camelCase vars, PascalCase types/components
- [ ] TypeScript strict (no unexplained `any`)
- [ ] Every API has Zod validation + error handling + auth check
- [ ] DB writes touching >1 table use transactions
- [ ] List endpoints support page, pageSize, search, sort, order
- [ ] Money values use *_cents (integers)
- [ ] No console.log left behind (use logger)
- [ ] No new dependencies without confirmation
- [ ] Docs updated (user-guide, api, modules)
- [ ] Tracker updated

Report issues with file:line references. If clean, say so explicitly.
