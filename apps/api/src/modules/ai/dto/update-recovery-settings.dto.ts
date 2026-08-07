import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateRecoverySettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  maxAttempts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 720 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  cooldownHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stopOnReply?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stopOnHumanTakeover?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Hours from campaign anchor for R1/R2/R3 (e.g. [24,72,168])',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(720, { each: true })
  cadenceHours?: number[];

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 23 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  allowedHoursStart?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 24 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  allowedHoursEnd?: number | null;
}
