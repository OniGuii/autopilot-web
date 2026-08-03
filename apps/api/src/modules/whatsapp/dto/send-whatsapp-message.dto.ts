import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** P3-C1: leadId and conversationId are both required. */
export class SendWhatsappMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  leadId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ example: 'Olá! Segue a proposta.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body!: string;
}
