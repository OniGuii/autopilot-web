import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompanyContextGuard } from '../auth/guards/company-context.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import {
  ListImportBatchesQueryDto,
  PasteImportDto,
  UpdateImportMappingDto,
} from './dto/paste-import.dto';
import { OUTBOUND_IMPORT_MAX_BYTES } from './outbound-import.constants';
import { OutboundImportService } from './outbound-import.service';

@ApiTags('outbound')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyContextGuard, RolesGuard)
@Controller('outbound/import')
export class OutboundImportController {
  constructor(private readonly imports: OutboundImportService) {}

  @Get('dashboard')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Lead Import dashboard (V1.2)' })
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.imports.dashboard(this.actor(user));
  }

  @Get('batches')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'List import batches' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListImportBatchesQueryDto,
  ) {
    return this.imports.list(
      this.actor(user),
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  @Get('batches/:id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Get import batch' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.get(this.actor(user), id);
  }

  @Post('batches/upload')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        sourceDefault: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Upload CSV/XLSX import batch' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: OUTBOUND_IMPORT_MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('sourceDefault') sourceDefault: string | undefined,
    @Req() req: Request,
  ) {
    return this.imports.createFromUpload(
      this.actor(user),
      file,
      sourceDefault,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @Post('batches/paste')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Create import batch from pasted table/text' })
  paste(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PasteImportDto,
    @Req() req: Request,
  ) {
    return this.imports.createFromPaste(this.actor(user), dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch('batches/:id/mapping')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Set column mapping for batch' })
  mapping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImportMappingDto,
    @Req() req: Request,
  ) {
    return this.imports.updateMapping(this.actor(user), id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('batches/:id/validate')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Dry-run validate batch (dedupe/suppress/phone)' })
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.imports.validate(this.actor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('batches/:id/commit')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Commit valid rows into Lead table' })
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.imports.commit(this.actor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('batches/:id/cancel')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Cancel import batch' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.imports.cancel(this.actor(user), id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  private actor(user: AuthenticatedUser) {
    if (!user.cid || !user.sub) throw new Error('Company context required');
    return user as AuthenticatedUser & { cid: string; sub: string };
  }
}
