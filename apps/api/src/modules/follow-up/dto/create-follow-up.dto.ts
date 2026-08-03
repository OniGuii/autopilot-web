import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateFollowUpDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  leadId!: string;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  conversationId?: string | null;

  @ApiProperty({
    example: 'Oi! Vi que você se interessou. Posso te ajudar?',
  })
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  suggestedBody!: string;

  @ApiPropertyOptional({ default: 'RECOVERY' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  type?: string;

  @ApiPropertyOptional({ enum: Channel, default: Channel.WHATSAPP })
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assignedUserId?: string | null;
}
