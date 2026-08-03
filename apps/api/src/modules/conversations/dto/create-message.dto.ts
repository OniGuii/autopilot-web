import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageDirection } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

/**
 * direction semantics (frozen):
 * - INBOUND  = cliente → empresa
 * - OUTBOUND = empresa → cliente
 */
export class CreateMessageDto {
  @ApiProperty({
    enum: MessageDirection,
    description: 'INBOUND = cliente→empresa; OUTBOUND = empresa→cliente',
  })
  @IsEnum(MessageDirection)
  direction!: MessageDirection;

  @ApiProperty({ example: 'Olá! Ainda tem interesse?' })
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional. OUTBOUND defaults to JWT.sub. INBOUND must be omitted/null. If set, must be ACTIVE member.',
  })
  @IsOptional()
  @IsUUID()
  senderUserId?: string;
}
