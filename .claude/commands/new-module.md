---
description: Scaffold a new ERP module end-to-end
---

You are starting a new module: $ARGUMENTS

Steps to follow IN ORDER (do not skip):

1. Read CLAUDE.md to refresh project conventions.
2. Read docs/modules/$ARGUMENTS.md (the spec). If it doesn't exist, create it from the template in CLAUDE.md section 6 and STOP for review.
3. Update Prisma schema (backend/src/prisma/schema.prisma) only if the module needs new tables. Run `npx prisma migrate dev --name add_$ARGUMENTS`.
4. Backend: create folder backend/src/modules/$ARGUMENTS/ with: $ARGUMENTS.schema.ts, $ARGUMENTS.service.ts, $ARGUMENTS.controller.ts, $ARGUMENTS.routes.ts. Follow the pattern in modules/auth/.
5. Register the router in backend/src/modules/index.ts.
6. Frontend: create folder frontend/src/pages/$ARGUMENTS/ and a service file in frontend/src/services/.
7. Add route to frontend/src/App.tsx and nav item in components/layout/AppShell.tsx.
8. Create docs/user-guide/$ARGUMENTS.md describing how to use the feature.
9. Create docs/api/$ARGUMENTS.md listing every endpoint with example payloads.
10. Update ERP_Tracker.xlsx → "Modules" sheet → set this module to "Done".
11. Update CLAUDE.md section 7 ("Current Module Pointer") to the next module.
12. Summarize what changed in 5 lines.

If at any step you are unsure, ASK before proceeding. Do not guess.
