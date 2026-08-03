export const SEED_MARKER = 'autopilot-seed' as const;

/** Shared password for local/demo/test seed users (argon2-hashed at seed time). */
export const SEED_PASSWORD = 'Demo@12345' as const;

export const LOCAL = {
  companySlug: 'local-demo',
  companyName: 'AutoPilot Local',
  users: [
    {
      email: 'owner@local.autopilot.dev',
      name: 'Owner Local',
      role: 'OWNER' as const,
    },
    {
      email: 'admin@local.autopilot.dev',
      name: 'Admin Local',
      role: 'ADMIN' as const,
    },
    {
      email: 'agent@local.autopilot.dev',
      name: 'Agent Local',
      role: 'AGENT' as const,
    },
  ],
  leadCount: 50,
  phonePrefix: '+1555100', // +15551000001 ...
} as const;

export const DEMO = {
  dealership: {
    slug: 'demo-concessionaria',
    name: 'AutoPrime Veículos (Demo)',
    timezone: 'America/Sao_Paulo',
  },
  workshop: {
    slug: 'demo-oficina',
    name: 'Oficina MotorMax (Demo)',
    timezone: 'America/Sao_Paulo',
  },
  users: [
    {
      email: 'owner.concessionaria@demo.autopilot.dev',
      name: 'Carla Owner Demo',
      role: 'OWNER' as const,
      company: 'dealership' as const,
    },
    {
      email: 'admin.concessionaria@demo.autopilot.dev',
      name: 'Bruno Admin Demo',
      role: 'ADMIN' as const,
      company: 'dealership' as const,
    },
    {
      email: 'agent.concessionaria@demo.autopilot.dev',
      name: 'Ana Agent Demo',
      role: 'AGENT' as const,
      company: 'dealership' as const,
    },
    {
      email: 'owner.oficina@demo.autopilot.dev',
      name: 'Diego Owner Oficina',
      role: 'OWNER' as const,
      company: 'workshop' as const,
    },
    {
      email: 'agent.oficina@demo.autopilot.dev',
      name: 'Fernanda Agent Oficina',
      role: 'AGENT' as const,
      company: 'workshop' as const,
    },
  ],
  leadCountPerCompany: 100,
  dealershipPhonePrefix: '+1555200',
  workshopPhonePrefix: '+1555300',
} as const;

export const TEST = {
  companySlug: 'test-fixture',
  companyName: 'AutoPilot Test Fixture',
  ownerEmail: 'owner@test.autopilot.dev',
  ownerName: 'Owner Test',
  leadPhone: '+15559990001',
} as const;

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'RESPONDED',
  'QUALIFIED',
  'CONVERTED',
  'LOST',
] as const;

export type SeedProfile = 'local' | 'demo' | 'test';
