import { IsString, IsBoolean, IsOptional, IsIn } from 'class-validator';

export class UpdatePrivacySettingsDto {
  @IsOptional()
  @IsString()
  @IsIn(['everyone', 'friends', 'nobody'])
  whoCanMessage?: string;

  @IsOptional()
  @IsString()
  @IsIn(['everyone', 'friends', 'nobody'])
  whoCanSeeFriends?: string;

  @IsOptional()
  @IsString()
  @IsIn(['everyone', 'friends', 'nobody'])
  whoCanAddToGroups?: string;

  @IsOptional()
  @IsBoolean()
  hideOnlineStatus?: boolean;
}
