import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CAMPAIGN_ADD_LEADS_MAX } from '../outbound-campaign.constants';

export class AddCampaignLeadsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CAMPAIGN_ADD_LEADS_MAX)
  @IsUUID('4', { each: true })
  leadIds!: string[];
}

export class RemoveCampaignLeadsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CAMPAIGN_ADD_LEADS_MAX)
  @IsUUID('4', { each: true })
  leadIds!: string[];
}

export class AttachImportBatchDto {
  @ApiProperty({
    description: 'Import batch id — adds all committed leads from that batch',
  })
  @IsUUID()
  importBatchId!: string;
}

export class GenerateCampaignFirstTouchDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
