import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AI_INSTRUCTION_MAX_CHARS } from '../ai.constants';

export class SuggestReplyDto {
  @ApiPropertyOptional({
    enum: ['professional', 'friendly', 'concise'],
    default: 'professional',
  })
  @IsOptional()
  @IsIn(['professional', 'friendly', 'concise'])
  tone?: 'professional' | 'friendly' | 'concise';

  @ApiPropertyOptional({
    description: 'Optional extra instruction for the model (max 500 chars)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(AI_INSTRUCTION_MAX_CHARS)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  instruction?: string;
}
