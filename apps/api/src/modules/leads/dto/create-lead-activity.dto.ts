import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadActivityType } from '@prisma/client';
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

export class CreateLeadActivityDto {
  @ApiProperty({ enum: LeadActivityType })
  @IsEnum(LeadActivityType)
  type!: LeadActivityType;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(10_000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Assignee user id (defaults to actor)',
  })
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
}
