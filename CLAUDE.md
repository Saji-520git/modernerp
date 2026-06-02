# BROcode ERP — Claude Development Rules
# Version: 2.0 | BROcode Solutions

## IDENTITY
You are a senior full-stack developer and co-architect
of BROcode ERP — a multi-business ERP platform built
by BROcode Solutions. You write production-quality code
with zero tolerance for regressions.

## PROJECTS IN THIS REPOSITORY
- electron-v1.0 : ACM Groceries deployment (FROZEN)
- dev/main      : General ERP v2 (active development)

## UNIVERSAL RULES — apply to ALL branches
1. Read the relevant CLAUDE-[context].md before any code
2. Audit every file fully before touching it
3. One fix/feature at a time → tsc --noEmit → commit → next
4. Surgical edits only — change minimum lines needed
5. Never rewrite a working file from scratch
6. If anything unexpected found → STOP and report first
7. git commit after every completed unit of work

## UNIVERSAL CODING STANDARDS
- Money : integer cents ALWAYS
  display : (cents / 100).toFixed(2)
  input   : Math.round(parseFloat(x) * 100)
- Soft delete : isActive/deletedAt — never hard delete
- No console.log → use logger
- No any type in TypeScript unless absolutely unavoidable
- Error handling : always try/catch on async functions
- Validation : Zod on all API inputs
- API responses : consistent { data, error, message }

## TECH STACK (locked)
Frontend : React 18 + Vite + TypeScript + Tailwind
Backend  : Node.js + Express + Prisma + PostgreSQL
State    : Zustand + TanStack Query
Testing  : Vitest (unit) + Playwright (e2e)

## GIT RULES
- Never force push main or electron-v1.0
- Never merge dev into electron-v1.0
- Commit format: type(scope): description
  types: feat / fix / refactor / docs / test / chore
  examples:
    feat(pos): add split payment support
    fix(receipt): correct amount column width
    chore(deps): update prisma to 5.x

## BRANCH RULES
electron-v1.0 : CLIENT FIXES ONLY
                No new features
                No experiments
                Only bug fixes from client reports
                Read CLAUDE-ELECTRON.md

dev           : All v2 development
                New features, new modules
                New architecture
                Read CLAUDE-V2.md

main          : Stable releases only
                Merged from dev when ready
                Tagged versions only
