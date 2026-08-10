import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  FIRST_TOUCH_MODES,
  FIRST_TOUCH_PLAYBOOKS,
} from '../outbound-first-touch.constants';

export class UpdateFirstTouchSettingsDto {
  @ApiPropertyOptional({
    enum: Object.values(FIRST_TOUCH_MODES),
  })
  @IsOptional()
  @IsIn(Object.values(FIRST_TOUCH_MODES))
  mode?: string;

  @ApiPropertyOptional({
    enum: Object.values(FIRST_TOUCH_PLAYBOOKS),
  })
  @IsOptional()
  @IsIn(Object.values(FIRST_TOUCH_PLAYBOOKS))
  verticalPlaybook?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxBatchSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireImportBatch?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enableKbGrounding?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enableMemorySeed?: boolean;
}
