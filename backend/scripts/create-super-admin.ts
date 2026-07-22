/**
 * Vendor-only onboarding tool: create the SUPER_ADMIN account on a fresh install.
 *
 * SUPER_ADMIN is intentionally not creatable through the client-facing UI, so the
 * vendor bootstraps it here at deploy time. The vendor supplies the password —
 * it is hashed (bcryptjs, 12 rounds) and never stored or logged in plain text.
 *
 *   npx tsx scripts/create-super-admin.ts <email> "<Full Name>" <password>
 *
 * If the email already exists, use promote-super-admin.ts instead.
 * Password policy: min 8 chars, at least one letter and one number.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;
const [, , email, fullName, password] = process.argv;

async function main() {
  if (!email || !fullName || !password) {
    console.error('Usage: npx tsx scripts/create-super-admin.ts <email> "<Full Name>" <password>');
    process.exit(1);
  }
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    console.error('Password must be at least 8 characters and include a letter and a number.');
    process.exit(1);
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`A user with ${email} already exists. Use promote-super-admin.ts to elevate it instead.`);
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await prisma.user.create({ data: { email, fullName, passwordHash, role: 'SUPER_ADMIN', isActive: true } });
  console.log(`✓ Created SUPER_ADMIN ${email}. Sign in, then enable features in Settings → Modules and create the client's admin/roles.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
