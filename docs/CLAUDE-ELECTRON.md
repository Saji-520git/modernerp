# BROcode ERP — Electron Client Rules
# Applies to: electron-v1.0 branch ONLY

## PURPOSE
This branch serves deployed offline clients.
ACM Groceries is the current deployment.
Stability is the highest priority.

## ELECTRON-SPECIFIC RULES
1. Never touch Prisma schema (schema.prisma)
   — migrations are locked for deployed clients
2. Never add npm packages without checking
   installer size impact (~360 MB baseline)
3. Always rebuild frontend before build:win
   cd frontend && npm run build
   cd .. && npm run build:win
4. Always verify installer timestamp after build
   New exe must be NEWER than win-unpacked folder
5. Tag every release: v1.0.XX-production
6. Test checklist must pass before tagging

## BUILD COMMANDS
cd frontend && npm run build        ← frontend first
cd .. && npm run build:win          ← then installer
Installer: C:\ModernERP-Build\ModernERP Setup 1.0.0.exe

## RELEASE CHECKLIST (must pass before every release)
[ ] tsc --noEmit : zero errors frontend + backend
[ ] Login screen appears on app open
[ ] Email pre-fills, password empty
[ ] POS sale completes successfully
[ ] Receipt prints correctly
[ ] Customer payment records correctly
[ ] Stock alerts reflect live inventory
[ ] Minimize shows in taskbar
[ ] Installer timestamp is fresh

## CLIENT BRANCHES
electron-v1.0          → ACM Groceries
electron-v1.0-client2  → Next local client (when needed)
Branch new clients FROM electron-v1.0, never from dev

## WHAT NOT TO TOUCH
- Working POS checkout flow
- Inventory deduction logic
- Auth / JWT / session
- Receipt layout (generateReceiptHtml.ts)
  unless specifically fixing a receipt bug
- Prisma schema
- Any working feature not mentioned in the fix prompt
