-- D15 local catalog review: cover the approval actor FK without changing lesson/history data.
begin;
create index academy_lessons_approved_by on public.academy_lessons(approved_by);
commit;
