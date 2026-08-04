import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MembershipRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { WhatsappSendService } from './outbound/whatsapp-send.service';
import { WhatsappService } from './whatsapp.service';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly whatsappSendService: WhatsappSendService,
  ) {}

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Connect / reconnect WhatsApp instance (returns QR when pending)',
  })
  connect(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.whatsappService.connect(this.asCompanyActor(user), {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'WhatsApp connection status (status, phoneNumber, instanceName, connectedAt)',
  })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.whatsappService.status(this.asCompanyActor(user));
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Disconnect instance (keeps row, status=DISCONNECTED)',
  })
  disconnect(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.whatsappService.disconnect(this.asCompanyActor(user), {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AGENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Send WhatsApp text message (Phase 3 outbound — requires CONNECTED instance)',
  })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendWhatsappMessageDto,
    @Req() req: Request,
  ) {
    return this.whatsappSendService.sendHttp(this.asCompanyActor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('webhook/:instanceKey')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Evolution webhook — connection, inbound, delivery acks, echo protection',
  })
  @ApiHeader({ name: 'X-Webhook-Secret', required: true })
  webhook(
    @Param('instanceKey', ParseUUIDPipe) instanceKey: string,
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.whatsappService.handleWebhook(instanceKey, secret, body ?? {});
  }

  private asCompanyActor(user: AuthenticatedUser) {
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
