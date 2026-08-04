import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { LeadsController } from './leads.controller';

describe('LeadsController ownership RBAC', () => {
  const leadsService = {
    create: jest.fn(),
    list: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    assign: jest.fn(),
    unassign: jest.fn(),
    bulkAssign: jest.fn(),
    remove: jest.fn(),
  };
  const timelineService = { getTimeline: jest.fn() };
  const controller = new LeadsController(
    leadsService as never,
    timelineService as never,
  );
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  function rolesFor(handler: (...args: never[]) => unknown): MembershipRole[] {
    return Reflect.getMetadata(ROLES_KEY, handler) as MembershipRole[];
  }

  function canActivate(
    role: MembershipRole,
    handler: (...args: never[]) => unknown,
  ): boolean {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(rolesFor(handler));
    const ctx = {
      getHandler: () => handler,
      getClass: () => LeadsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    };
    return guard.canActivate(ctx as never);
  }

  it('forbids AGENT on bulk-assign and unassign', () => {
    expect(() =>
      canActivate(MembershipRole.AGENT, controller.bulkAssign),
    ).toThrow(ForbiddenException);
    expect(() =>
      canActivate(MembershipRole.AGENT, controller.unassign),
    ).toThrow(ForbiddenException);
  });

  it('allows OWNER and ADMIN on bulk-assign and unassign', () => {
    expect(canActivate(MembershipRole.OWNER, controller.bulkAssign)).toBe(true);
    expect(canActivate(MembershipRole.ADMIN, controller.unassign)).toBe(true);
  });

  it('allows AGENT on timeline and assign', () => {
    expect(canActivate(MembershipRole.AGENT, controller.timeline)).toBe(true);
    expect(canActivate(MembershipRole.AGENT, controller.assign)).toBe(true);
  });
});
