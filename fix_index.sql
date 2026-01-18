-- Drop duplicate index if exists
DROP INDEX IF EXISTS "PostView_userId_postId_key";

-- Drop unique constraint if exists
ALTER TABLE "PostView" DROP CONSTRAINT IF EXISTS "unique_user_post_view";
