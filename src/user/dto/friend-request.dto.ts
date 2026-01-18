import { IsInt, IsNotEmpty } from 'class-validator';

export class FriendRequestDto {
  @IsInt()
  @IsNotEmpty()
  userId: number;
}
