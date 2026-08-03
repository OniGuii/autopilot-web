import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class ApproveFollowUpDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Optional schedule timestamp kept on the APPROVED follow-up',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;
}
