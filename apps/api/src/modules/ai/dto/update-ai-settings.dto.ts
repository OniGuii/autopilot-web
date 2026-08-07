import { ApiPropertyOptional } from '@nestjs/swagger';
import { AiAgentMode } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ enum: AiAgentMode })
  @IsOptional()
  @IsEnum(AiAgentMode)
  mode?: AiAgentMode;

  @ApiPropertyOptional({
    description: 'Reserved for 11C AUTO; stored but not enforced in 11A',
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxAutoRepliesPerLeadDay?: number;
}
