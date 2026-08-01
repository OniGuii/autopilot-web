/**
 * Prisma Client Extensions — scaffolds only.
 * Not registered on PrismaService yet.
 */
export {
  TENANT_SCOPED_MODELS,
  GLOBAL_MODELS,
  createTenantExtension,
  assertSameTenant,
} from './tenant.extension';
export type {
  TenantScopedModel,
  TenantExtensionOptions,
} from './tenant.extension';

export {
  SOFT_DELETE_MODELS,
  createSoftDeleteExtension,
  notDeletedWhere,
} from './soft-delete.extension';
export type {
  SoftDeleteModel,
  SoftDeleteExtensionOptions,
} from './soft-delete.extension';
