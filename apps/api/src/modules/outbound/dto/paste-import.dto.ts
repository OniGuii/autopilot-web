import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  OUTBOUND_IMPORT_DEFAULT_SOURCE,
  OUTBOUND_IMPORT_MAX_ROWS,
} from '../outbound-import.constants';

export class PasteImportDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  headers?: string[];

  @ApiPropertyOptional({
    description: 'Data rows (without header). Max 500.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(OUTBOUND_IMPORT_MAX_ROWS + 1)
  rows?: string[][];

  @ApiPropertyOptional({
    description: 'Raw pasted TSV/CSV text (headers on first line)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  text?: string;

  @ApiPropertyOptional({ default: OUTBOUND_IMPORT_DEFAULT_SOURCE })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  sourceDefault?: string;
}

export class UpdateImportMappingDto {
  @ApiProperty({
    description: 'Map target field → source header name',
    example: { phone: 'Telefone', name: 'Nome', city: 'Cidade' },
  })
  @Allow()
  columnMapping!: Record<string, string | null | undefined>;

  @ApiPropertyOptional({ default: OUTBOUND_IMPORT_DEFAULT_SOURCE })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  sourceDefault?: string;

  @ApiPropertyOptional({ enum: ['skip', 'reject'], default: 'skip' })
  @IsOptional()
  @IsIn(['skip', 'reject'])
  dedupeMode?: 'skip' | 'reject';
}

export class ListImportBatchesQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
