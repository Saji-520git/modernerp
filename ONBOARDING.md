# Onboarding a New Client

Each client is a separate install with its own database and its own **super-admin**.
The super-admin is a vendor-held account: it sees and operates every area, and it is
the only role that can turn features on/off.

## Deploy steps

1. **Provision** the app + a fresh PostgreSQL database for the client.

2. **Apply the schema** (files only — never `migrate dev` on a shared/prod DB):
   ```bash
   cd backend
   npx prisma migrate deploy --schema src/prisma/schema.prisma
   npx prisma generate --schema src/prisma/schema.prisma
   ```

3. **Create the super-admin** (vendor picks the email + password):
   ```bash
   npx tsx scripts/create-super-admin.ts <email> "<Full Name>" <password>
   ```
   Password: min 8 chars, at least one letter and one number. If the email already
   exists (e.g. from a seed), elevate it instead:
   ```bash
   npx tsx scripts/promote-super-admin.ts <email>
   ```

4. **Sign in as the super-admin** and open **Settings → Modules**. Enable only the
   features this client bought (Promotions, Stock-take, Loyalty, Quotations,
   User Management, …). Everything optional is **off by default**.

5. **Create the client's admin and roles.** Enable **User Management** first, then
   add the client's own admin user and any cashier/manager/staff accounts.

## Notes

- **User Management is itself a module.** While it's off, no one but the super-admin
  reaches `/users`. Turn it on before handing user administration to the client.
- **Client admins never see super-admin accounts** — they're hidden from the user
  list, stats, and detail, and can't be modified by a non-super-admin.
- The super-admin bypasses every module gate, so vendor support always has full
  access regardless of which features a client has enabled.
