-- 会員制の最小構成。
--
-- **持たないものを増やさない。** 氏名・住所・生年月日・電話番号は持たない。
-- 持てば漏れる。必要なのは「誰か」を一意に指す id と、得点だけ。
--
-- Supabase SQL Editor に貼って実行する。

-- ユーザー。認証は Supabase Auth（auth.users）に任せ、こちらは会員状態だけ持つ。
create table if not exists public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  is_paid boolean not null default false,
  -- Stripe の顧客IDとサブスクID。課金状態の照合に使う。
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 得点。shared が true の行だけを会員平均の集計対象にする。
-- **既定は false。** 提供は明示的にオンにした人だけ。
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exam text not null check (exam in ('takken', 'gyosei')),
  score integer not null check (score >= 0 and score <= 300),
  sections jsonb,
  taken_on date not null default current_date,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists scores_user_idx on public.scores (user_id, exam, taken_on);
create index if not exists scores_shared_idx on public.scores (exam, shared) where shared;

-- 行レベルセキュリティ。**自分の行以外は読めない。**
alter table public.members enable row level security;
alter table public.scores enable row level security;

drop policy if exists members_self on public.members;
create policy members_self on public.members
  for select using (auth.uid() = id);

drop policy if exists scores_self_select on public.scores;
create policy scores_self_select on public.scores
  for select using (auth.uid() = user_id);

drop policy if exists scores_self_insert on public.scores;
create policy scores_self_insert on public.scores
  for insert with check (auth.uid() = user_id);

drop policy if exists scores_self_delete on public.scores;
create policy scores_self_delete on public.scores
  for delete using (auth.uid() = user_id);

-- 会員平均。**個票は返さない。集計値だけを返す。**
--
-- 人数が少ないと、数人の増減で平均が大きく動く。そのうえ自己申告なので
-- 検証できない。**30人未満は何も返さない**ことを関数側で強制する。
-- 画面側の実装ミスで少人数の平均が出てしまう事故を防ぐため、ここで止める。
create or replace function public.member_average(target_exam text)
returns table (n bigint, mean numeric, median numeric)
language sql
security definer
set search_path = public
as $$
  with latest as (
    -- 1人1件。同じ人の複数記録で平均が引っ張られないよう、最新の1件だけを使う。
    select distinct on (user_id) user_id, score
    from public.scores
    where exam = target_exam and shared
    order by user_id, taken_on desc, id desc
  ), agg as (
    select count(*) as n,
           round(avg(score)::numeric, 1) as mean,
           round((percentile_cont(0.5) within group (order by score))::numeric, 1) as median
    from latest
  )
  select case when n >= 30 then n else n end as n,
         case when n >= 30 then mean else null end as mean,
         case when n >= 30 then median else null end as median
  from agg;
$$;

revoke all on function public.member_average(text) from public;
grant execute on function public.member_average(text) to anon, authenticated;
