# ModernERP

A modern, beginner-friendly, AI-built ERP system. Built incrementally with Claude Code.

## Quick Start

```bash
# 1. Clone
git clone <your-repo> modern-erp && cd modern-erp

# 2. Copy env files
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Start Postgres
docker compose up -d

# 4. Install + migrate + seed
cd backend && npm install && npx prisma migrate dev && npm run seed
cd ../frontend && npm install

# 5. Run (in two terminals)
cd backend && npm run dev      # http://localhost:4000
cd frontend && npm run dev     # http://localhost:5173
```

Default login (after seed):
- email: `admin@modernerp.local`
- password: `admin123`

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — read this if you're working with Claude Code
- **[docs/user-guide](./docs/user-guide/)** — how to USE the system
- **[docs/dev-guide](./docs/dev-guide/)** — how to BUILD the system
- **[docs/api](./docs/api/)** — REST API reference
- **[docs/modules](./docs/modules/)** — module specifications

## Roadmap

**Phase 1 (current):** POS · Inventory · Purchases · Sales
**Phase 2:** Accounting · HR · Payroll · CRM
**Phase 3:** Manufacturing · Projects · Advanced Reports
**Phase 4:** Multi-branch · E-commerce · Mobile App

## Tech Stack

React 18 · TypeScript · Tailwind · shadcn/ui · Node.js · Express · Prisma · PostgreSQL · Zod · Zustand · TanStack Query

## License

MIT
