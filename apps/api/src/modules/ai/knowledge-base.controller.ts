import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateKnowledgeBaseEntryDto } from './dto/create-knowledge-base-entry.dto';
import { ListKnowledgeBaseQueryDto } from './dto/list-knowledge-base.query.dto';
import { UpdateKnowledgeBaseEntryDto } from './dto/update-knowledge-base-entry.dto';
import { KnowledgeBaseService } from './knowledge-base.service';

@ApiTags('knowledge-base')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly kb: KnowledgeBaseService) {}

  @Get()
  @ApiOperation({ summary: 'List knowledge base entries' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListKnowledgeBaseQueryDto,
  ) {
    return this.kb.list(this.actor(user), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get knowledge base entry' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.kb.get(this.actor(user), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create knowledge base entry' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateKnowledgeBaseEntryDto,
    @Req() req: Request,
  ) {
    return this.kb.create(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update knowledge base entry' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeBaseEntryDto,
    @Req() req: Request,
  ) {
    return this.kb.update(this.actor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete knowledge base entry' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kb.softDelete(this.actor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
