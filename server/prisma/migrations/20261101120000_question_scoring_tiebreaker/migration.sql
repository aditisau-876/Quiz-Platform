-- Per-question scoring and tie-breaker flag
ALTER TABLE "Question"
  ADD COLUMN "basePoints" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "negativePoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isTieBreaker" BOOLEAN NOT NULL DEFAULT false;

-- Keep existing quizzes scoring exactly as before: copy each quiz's old base points onto its questions
UPDATE "Question" AS q SET "basePoints" = z."basePoints" FROM "Quiz" AS z WHERE q."quizId" = z."id";