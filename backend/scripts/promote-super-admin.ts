/**
 * Vendor-only tool: promote an EXISTING user account to SUPER_ADMIN.
 *
 * SUPER_ADMIN is deliberately not creatable through the client-facing UI (the
 * user role dropdown excludes it), so the vendor designates a super-admin here.
 * Uses an existing account — no password is set or read.
 *
 *   npx tsx scripts/promote-super-admin.ts <email>
 *
 * Leaves the account's custom permissions untouched; if they were null (role
 * defaults), the SUPER_ADMIN default grants manage_modules automatically.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const email = process.argv[2];

async function main() {
  if (!email) {
    console.error('Usage: npx tsx scripts/promote-super-admin.ts <email>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email: ${email}`);
    process.exit(1);
  }
  await prisma.user.update({ where: { email }, data: { role: 'SUPER_ADMIN' } });
  console.log(`✓ Promoted ${email} to SUPER_ADMIN. They must sign out and back in for the new role to take effect.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
