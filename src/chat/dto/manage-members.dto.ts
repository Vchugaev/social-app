import { IsArray, IsEnum, IsNumber, ArrayMinSize } from 'class-validator';

export enum ChatRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
  MEMBER = 'member',
}

export class AddMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  userIds: number[];
}

export class RemoveMemberDto {
  @IsNumber()
  userId: number;
}

export class UpdateMemberRoleDto {
  @IsNumber()
  userId: number;

  @IsEnum(ChatRole)
  role: ChatRole;
}
