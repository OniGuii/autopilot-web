import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'owner.concessionaria@demo.autopilot.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Demo@12345' })
  @IsString()
  @MinLength(8)
  password!: string;
}
