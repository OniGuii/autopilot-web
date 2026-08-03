import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class ApproveFollowUpDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Optional schedule timestamp (P4-A1: approve → SCHEDULED; defaults to now)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;
}
