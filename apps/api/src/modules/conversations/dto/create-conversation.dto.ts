import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel, ConversationStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  leadId!: string;

  @ApiPropertyOptional({ enum: Channel, default: Channel.WHATSAPP })
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @ApiPropertyOptional({
    enum: ConversationStatus,
    default: ConversationStatus.OPEN,
  })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Defaults to null. Must be ACTIVE membership in company.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assignedUserId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(191)
  externalThreadId?: string | null;
}
