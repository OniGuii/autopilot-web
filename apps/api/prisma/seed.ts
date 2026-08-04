import 'dotenv/config';
import { prisma } from './seeds/shared/client';
import type { SeedProfile } from './seeds/shared/constants';
import { seedLocal } from './seeds/local';
import { seedDemo } from './seeds/demo';
import { seedPilot } from './seeds/pilot';
import { seedTest } from './seeds/test';

function resolveProfile(): SeedProfile {
  const fromEnv = (process.env.SEED_PROFILE ?? '').toLowerCase();
  const fromArg = process.argv
    .find((arg) => arg.startsWith('--profile='))
    ?.split('=')[1]
    ?.toLowerCase();

  const profile = (fromArg || fromEnv || 'local') as SeedProfile;

  if (!['local', 'demo', 'test', 'pilot'].includes(profile)) {
    throw new Error(
      `Invalid SEED_PROFILE "${profile}". Use: local | demo | test | pilot`,
    );
  }

  return profile;
}

async function enableRlsBypass(): Promise<void> {
  // 8B — seeds run as migrator/admin: bypass FORCE RLS for the session.
  await prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', false)`;
  await prisma.$executeRaw`SELECT set_config('app.company_id', '', false)`;
}

async function main() {
  const profile = resolveProfile();
  // eslint-disable-next-line no-console
  console.log(`\n[autopilot-seed] Starting profile="${profile}"`);

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to seed when NODE_ENV=production (set ALLOW_PROD_SEED=true to override).',
    );
  }

  await enableRlsBypass();

  let counts;
  switch (profile) {
    case 'local':
      counts = await seedLocal();
      break;
    case 'demo':
      counts = await seedDemo();
      break;
    case 'test':
      counts = await seedTest();
      break;
    case 'pilot':
      counts = await seedPilot();
      break;
  }

  // Pool may hand a connection without GUC — refresh before printing counts.
  await enableRlsBypass();

  // eslint-disable-next-line no-console
  console.log('[autopilot-seed] Completed successfully');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ profile, counts }, null, 2));
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[autopilot-seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
