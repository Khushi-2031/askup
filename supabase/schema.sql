-- ============================
-- AskUp — Supabase Schema
-- Run this in the Supabase SQL editor
-- ============================

-- Sessions
create table if not exists sessions (
  id            text primary key,
  title         text not null,
  description   text,
  host_name     text not null default 'Host',
  created_at    timestamptz default now(),
  is_active     boolean default true,
  admin_token   text not null
);

-- Questions
create table if not exists questions (
  id            uuid default gen_random_uuid() primary key,
  session_id    text references sessions(id) on delete cascade,
  text          text not null,
  author_name   text,
  is_anonymous  boolean default false,
  votes         integer default 0,
  is_answered   boolean default false,
  created_at    timestamptz default now()
);

-- Votes (prevents duplicate voting per voter_id)
create table if not exists votes (
  question_id   uuid references questions(id) on delete cascade,
  voter_id      text not null,
  created_at    timestamptz default now(),
  primary key (question_id, voter_id)
);

-- Indexes
create index if not exists idx_questions_session on questions(session_id);
create index if not exists idx_questions_votes on questions(votes desc);
create index if not exists idx_votes_question on votes(question_id);

-- Enable Row Level Security
alter table sessions  enable row level security;
alter table questions enable row level security;
alter table votes     enable row level security;

-- Permissive RLS policies (suitable for AMA event tool)
create policy "public_read_sessions"  on sessions  for select using (true);
create policy "public_write_sessions" on sessions  for insert with check (true);
create policy "public_update_sessions" on sessions for update using (true);

create policy "public_read_questions"   on questions for select using (true);
create policy "public_insert_questions" on questions for insert with check (true);
create policy "public_update_questions" on questions for update using (true);
create policy "public_delete_questions" on questions for delete using (true);

create policy "public_read_votes"   on votes for select using (true);
create policy "public_insert_votes" on votes for insert with check (true);
create policy "public_delete_votes" on votes for delete using (true);

-- Enable realtime on all tables
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table questions;
alter publication supabase_realtime add table votes;

-- ============================
-- Atomic vote function
-- Handles vote + un-vote safely
-- ============================
create or replace function cast_vote(
  p_question_id uuid,
  p_voter_id    text,
  p_is_upvote   boolean
)
returns jsonb
language plpgsql
security definer
as $$
begin
  if p_is_upvote then
    insert into votes (question_id, voter_id)
    values (p_question_id, p_voter_id)
    on conflict do nothing;

    if found then
      update questions set votes = votes + 1 where id = p_question_id;
      return '{"success":true,"action":"voted"}'::jsonb;
    end if;
    return '{"success":false,"action":"already_voted"}'::jsonb;

  else
    delete from votes
    where question_id = p_question_id and voter_id = p_voter_id;

    if found then
      update questions set votes = greatest(votes - 1, 0) where id = p_question_id;
      return '{"success":true,"action":"unvoted"}'::jsonb;
    end if;
    return '{"success":false,"action":"not_voted"}'::jsonb;
  end if;
end;
$$;
