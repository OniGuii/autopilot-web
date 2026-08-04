import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { ExportQueryDto } from './dto/export.query.dto';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('leads')
  @ApiOperation({ summary: 'Export leads CSV (hard cap 10000)' })
  async exportLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.exportsService.exportLeads(
      this.asActor(user),
      query,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.sendCsv(res, result.filename, result.csv);
  }

  @Get('activities')
  @ApiOperation({ summary: 'Export activities CSV (hard cap 10000)' })
  async exportActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.exportsService.exportActivities(
      this.asActor(user),
      query,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.sendCsv(res, result.filename, result.csv);
  }

  @Get('followups')
  @ApiOperation({ summary: 'Export follow-ups CSV (hard cap 10000)' })
  async exportFollowUps(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.exportsService.exportFollowUps(
      this.asActor(user),
      query,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.sendCsv(res, result.filename, result.csv);
  }

  private sendCsv(res: Response, filename: string, csv: string) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.status(200).send(csv);
  }

  private asActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
