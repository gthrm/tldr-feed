import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SubscribeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'not an email address' })
  @MaxLength(254)
  email!: string;

  /** A honeypot: a field a person never sees and never fills, unlike a bot. */
  @IsOptional()
  @IsString()
  website?: string;
}
