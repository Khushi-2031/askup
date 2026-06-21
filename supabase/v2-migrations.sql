-- ============================
-- AskUp v2 — New Feature Migrations
-- Run this in Supabase SQL editor AFTER the original schema.sql
-- ============================

-- New columns on questions
ALTER TABLE questions ADD COLUMN IF NOT EXISTS voter_id text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS author_emoji text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS me_too_count integer default 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS satisfaction_up integer default 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS satisfaction_down integer default 0;

-- Me Too votes table
CREATE TABLE IF NOT EXISTS me_too_votes (
  question_id   uuid references questions(id) on delete cascade,
  voter_id      text not null,
  created_at    timestamptz default now(),
  primary key (question_id, voter_id)
);

-- Satisfaction votes table
CREATE TABLE IF NOT EXISTS satisfaction_votes (
  question_id   uuid references questions(id) on delete cascade,
  voter_id      text not null,
  is_positive   boolean not null,
  created_at    timestamptz default now(),
  primary key (question_id, voter_id)
);

-- RLS
ALTER TABLE me_too_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE satisfaction_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_me_too"    ON me_too_votes FOR SELECT USING (true);
CREATE POLICY "public_insert_me_too"  ON me_too_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "public_delete_me_too"  ON me_too_votes FOR DELETE USING (true);

CREATE POLICY "public_read_sat"   ON satisfaction_votes FOR SELECT USING (true);
CREATE POLICY "public_insert_sat" ON satisfaction_votes FOR INSERT WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE me_too_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE satisfaction_votes;

-- Atomic Me Too toggle
CREATE OR REPLACE FUNCTION cast_me_too(
  p_question_id uuid,
  p_voter_id    text,
  p_is_add      boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_is_add THEN
    INSERT INTO me_too_votes (question_id, voter_id)
    VALUES (p_question_id, p_voter_id)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE questions SET me_too_count = me_too_count + 1 WHERE id = p_question_id;
      RETURN '{"success":true,"action":"added"}'::jsonb;
    END IF;
    RETURN '{"success":false,"action":"already_added"}'::jsonb;
  ELSE
    DELETE FROM me_too_votes WHERE question_id = p_question_id AND voter_id = p_voter_id;
    IF FOUND THEN
      UPDATE questions SET me_too_count = GREATEST(me_too_count - 1, 0) WHERE id = p_question_id;
      RETURN '{"success":true,"action":"removed"}'::jsonb;
    END IF;
    RETURN '{"success":false,"action":"not_found"}'::jsonb;
  END IF;
END;
$$;

-- Satisfaction vote (one per user per question)
CREATE OR REPLACE FUNCTION cast_satisfaction(
  p_question_id uuid,
  p_voter_id    text,
  p_is_positive boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO satisfaction_votes (question_id, voter_id, is_positive)
  VALUES (p_question_id, p_voter_id, p_is_positive)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    IF p_is_positive THEN
      UPDATE questions SET satisfaction_up = satisfaction_up + 1 WHERE id = p_question_id;
    ELSE
      UPDATE questions SET satisfaction_down = satisfaction_down + 1 WHERE id = p_question_id;
    END IF;
    RETURN '{"success":true}'::jsonb;
  END IF;
  RETURN '{"success":false,"action":"already_rated"}'::jsonb;
END;
$$;
