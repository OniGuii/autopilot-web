import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateSetupCompanyDto } from './dto/create-setup-company.dto';
import { SetupService } from './setup.service';

@ApiTags('setup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Setup wizard checklist (company / WhatsApp / lead / message)',
  })
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.setupService.getStatus(user);
  }

  @Post('company')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create first company + OWNER membership (D4: max 1 per user)',
  })
  createCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSetupCompanyDto,
    @Req() req: Request,
  ) {
    return this.setupService.createCompany(user, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
