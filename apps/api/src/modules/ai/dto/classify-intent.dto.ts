import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ClassifyIntentDto {
  @ApiProperty({ description: 'Latest inbound (or target) message body' })
  @IsString()
  @MaxLength(4000)
  message!: string;

  @ApiPropertyOptional({
    description: 'Recent conversation snippets (oldest→newest)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  recentContext?: string[];
}
