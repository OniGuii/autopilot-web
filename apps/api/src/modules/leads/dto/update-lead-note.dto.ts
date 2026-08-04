import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateLeadNoteDto {
  @ApiProperty({ description: 'Updated note body (max 10000 chars)' })
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body!: string;
}
