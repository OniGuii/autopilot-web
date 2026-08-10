import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GenerateFirstTouchDto {
  @ApiPropertyOptional({
    description: 'Explicit lead IDs to generate D0 for',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  leadIds?: string[];

  @ApiPropertyOptional({
    description: 'Only leads from this import batch (metadata.importBatchId)',
  })
  @IsOptional()
  @IsUUID()
  importBatchId?: string;

  @ApiPropertyOptional({
    description: 'Cap for this generation (defaults to settings.maxBatchSize)',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
