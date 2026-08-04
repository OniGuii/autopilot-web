import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { normalizePhone } from '../utils/normalize-phone';

export class CreateLeadDto {
  @ApiProperty({ example: 'Maria Silva' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({
    example: '+55 (11) 99999-0001',
    description: 'Normalized to digits only',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePhone(value) : value,
  )
  phone!: string;

  @ApiPropertyOptional({ example: 'maria@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ example: 'WHATSAPP', default: 'WHATSAPP' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source?: string;

  @ApiPropertyOptional({ enum: LeadStatus, default: LeadStatus.NEW })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Defaults to null when omitted',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  externalId?: string;
}
