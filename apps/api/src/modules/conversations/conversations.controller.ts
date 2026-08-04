import {
  Body,
  Controller,
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
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create conversation for a lead in current company' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConversationDto,
    @Req() req: Request,
  ) {
    return this.conversationsService.create(this.asCompanyActor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({
    summary: 'List conversations (ordered by lastMessageAt DESC)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.conversationsService.list(this.asCompanyActor(user), query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get conversation with lead summary and last 50 messages',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversationsService.findOne(this.asCompanyActor(user), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update conversation' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
    @Req() req: Request,
  ) {
    return this.conversationsService.update(this.asCompanyActor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close conversation (status = CLOSED)' })
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.conversationsService.close(this.asCompanyActor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create message (INBOUND = cliente→empresa; OUTBOUND = empresa→cliente)',
  })
  createMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMessageDto,
    @Req() req: Request,
  ) {
    return this.conversationsService.createMessage(
      this.asCompanyActor(user),
      id,
      dto,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }

  private asCompanyActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
