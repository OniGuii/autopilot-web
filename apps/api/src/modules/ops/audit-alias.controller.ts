import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { OpsService } from './ops.service';

/** Alias surface for Audit Explorer V2 at /api/audit. */
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('audit')
export class AuditAliasController {
  constructor(private readonly opsService: OpsService) {}

  @Get()
  @ApiOperation({ summary: 'Audit Explorer V2 (alias of /api/ops/audit)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAuditQueryDto,
  ) {
    return this.opsService.listAudit(
      user as AuthenticatedUser & { cid: string; sub: string },
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Audit detail (alias of /api/ops/audit/:id)' })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.opsService.getAudit(
      user as AuthenticatedUser & { cid: string; sub: string },
      id,
    );
  }
}
