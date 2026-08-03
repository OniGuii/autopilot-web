import { ForbiddenException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { OpsController } from './ops.controller';

describe('OpsController permissions', () => {
  const opsService = {
    getOverview: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue({
      whatsappConnected: true,
      totalMessages: 0,
      pendingMessages: 0,
      failedMessages: 0,
      scheduledFollowUps: 0,
      overdueFollowUps: 0,
      executedFollowUps: 0,
    }),
    getAlerts: jest.fn(),
    getHealth: jest.fn(),
    listAudit: jest.fn(),
    getAudit: jest.fn(),
    listWebhooks: jest.fn(),
    getWebhook: jest.fn(),
    reconcileMessages: jest.fn(),
    reconcileFollowUps: jest.fn(),
  };

  const controller = new OpsController(opsService as never);
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  function rolesFor(handler: (...args: never[]) => unknown): MembershipRole[] {
    return Reflect.getMetadata(ROLES_KEY, handler) as MembershipRole[];
  }

  function canActivate(
    role: MembershipRole,
    handler: (...args: never[]) => unknown,
  ): boolean {
    const ctx = {
      getHandler: () => handler,
      getClass: () => OpsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    };
    // Ensure metadata is read from handler
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(rolesFor(handler));
    return guard.canActivate(ctx as never);
  }

  it('allows AGENT on read endpoints', () => {
    expect(canActivate(MembershipRole.AGENT, controller.getMetrics)).toBe(true);
    expect(canActivate(MembershipRole.AGENT, controller.getAlerts)).toBe(true);
    expect(canActivate(MembershipRole.AGENT, controller.listAudit)).toBe(true);
    expect(canActivate(MembershipRole.AGENT, controller.listWebhooks)).toBe(
      true,
    );
    expect(canActivate(MembershipRole.AGENT, controller.getHealth)).toBe(true);
  });

  it('denies AGENT on reconcile endpoints', () => {
    expect(() =>
      canActivate(MembershipRole.AGENT, controller.reconcileMessages),
    ).toThrow(ForbiddenException);
    expect(() =>
      canActivate(MembershipRole.AGENT, controller.reconcileFollowUps),
    ).toThrow(ForbiddenException);
  });

  it('allows OWNER and ADMIN on reconcile', () => {
    expect(
      canActivate(MembershipRole.OWNER, controller.reconcileMessages),
    ).toBe(true);
    expect(
      canActivate(MembershipRole.ADMIN, controller.reconcileFollowUps),
    ).toBe(true);
  });

  it('delegates metrics to service with company actor', async () => {
    const user = {
      sub: 'u1',
      cid: 'c1',
      mid: 'm1',
      role: MembershipRole.AGENT,
    } as never;
    await controller.getMetrics(user);
    expect(opsService.getMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ cid: 'c1', sub: 'u1' }),
    );
  });
});
