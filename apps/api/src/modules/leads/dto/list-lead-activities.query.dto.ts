import { ApiPropertyOptional } from '@nestjs/swagger';
import { LeadActivityStatus, LeadActivityType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListLeadActivitiesQueryDto {
  @ApiPropertyOptional({ enum: LeadActivityStatus })
  @IsOptional()
  @IsEnum(LeadActivityStatus)
  status?: LeadActivityStatus;

  @ApiPropertyOptional({ enum: LeadActivityType })
  @IsOptional()
  @IsEnum(LeadActivityType)
  type?: LeadActivityType;
}
