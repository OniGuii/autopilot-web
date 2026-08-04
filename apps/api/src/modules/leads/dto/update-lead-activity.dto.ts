import { ApiPropertyOptional } from '@nestjs/swagger';
import { LeadActivityStatus, LeadActivityType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateLeadActivityDto {
  @ApiPropertyOptional({ enum: LeadActivityType })
  @IsOptional()
  @IsEnum(LeadActivityType)
  type?: LeadActivityType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(10_000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date | null;

  @ApiPropertyOptional({
    enum: LeadActivityStatus,
    description: 'Only PLANNED → DONE|CANCELLED allowed',
  })
  @IsOptional()
  @IsEnum(LeadActivityStatus)
  status?: LeadActivityStatus;
}
