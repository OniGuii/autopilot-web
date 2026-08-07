import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KnowledgeBaseKind } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AI_KB_BODY_MAX, AI_KB_TITLE_MAX } from '../ai.constants';

export class CreateKnowledgeBaseEntryDto {
  @ApiProperty({ enum: KnowledgeBaseKind })
  @IsEnum(KnowledgeBaseKind)
  kind!: KnowledgeBaseKind;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(AI_KB_TITLE_MAX)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(AI_KB_BODY_MAX)
  body!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}
