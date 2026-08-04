import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class BulkAssignLeadsDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Owner user id, or null to mass-unassign',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  ownerId!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Lead ids to assign (max 100)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  @Type(() => String)
  leadIds!: string[];
}
