-- Add avatar support for group chats
ALTER TABLE "Chat" ADD COLUMN "avatarId" INTEGER;
ALTER TABLE "Chat" ADD COLUMN "description" TEXT;
ALTER TABLE "Chat" ADD COLUMN "createdById" INTEGER;

-- Add foreign key for chat avatar
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add foreign key for chat creator
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add unique constraint for chat avatar
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_avatarId_key" UNIQUE ("avatarId");

-- Update ChatMember role to support more roles
-- Existing roles: 'member'
-- New roles: 'admin', 'moderator'
-- Note: No migration needed for enum as we're using String type
