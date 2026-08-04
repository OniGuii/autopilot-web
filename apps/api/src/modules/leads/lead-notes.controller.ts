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
import { CreateLeadNoteDto } from './dto/create-lead-note.dto';
import { UpdateLeadNoteDto } from './dto/update-lead-note.dto';
import { LeadNotesService } from './lead-notes.service';

@ApiTags('lead-notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('leads/:leadId/notes')
export class LeadNotesController {
  constructor(private readonly notesService: LeadNotesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create note on lead (author = JWT.sub)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: CreateLeadNoteDto,
    @Req() req: Request,
  ) {
    return this.notesService.create(this.asActor(user), leadId, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'List notes for lead (createdAt DESC)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.notesService.list(this.asActor(user), leadId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get note by id' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notesService.findOne(this.asActor(user), leadId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update note body (author or OWNER/ADMIN)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadNoteDto,
    @Req() req: Request,
  ) {
    return this.notesService.update(this.asActor(user), leadId, id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete note' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notesService.remove(this.asActor(user), leadId, id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private asActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & {
      cid: string;
      sub: string;
      role: MembershipRole;
    };
  }
}
