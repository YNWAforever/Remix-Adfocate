import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { completeLesson, getLearning, learningKey, type Lesson } from "@/lib/academyProgress";
import { Markdown } from "./Markdown";

export function AcademyLearning({ creatorId, slug }: { creatorId: string; slug: string }) {
  const { lang } = useI18n(), en = lang === "en", locale = en ? "en" : "zh-HK";
  const qc = useQueryClient(), key = learningKey(creatorId, slug, locale);
  const query = useQuery({ queryKey: key, queryFn: () => getLearning(slug, locale), retry: false });
  const complete = useMutation({ mutationFn: (lesson: Lesson) => completeLesson(slug, lesson),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const refresh = async () => { await query.refetch(); complete.reset(); };
  if (query.isPending) return <p role="status">{en ? "Loading lessons…" : "載入單元中…"}</p>;
  if (!query.data) return <div role="alert" className="space-y-2">
    <p>{en ? "Lessons could not be loaded. Please retry." : "暫時無法載入單元，請重試。"}</p>
    <button className="underline" onClick={() => query.refetch()}>{en ? "Retry lessons" : "重試載入單元"}</button>
  </div>;
  const learning = query.data;
  return <section aria-label={en ? "Course lessons" : "課程單元"} className="space-y-4">
    <h2 className="font-heading text-lg font-bold">{en ? "Course lessons" : "課程單元"}</h2>
    <p role="status">{learning.progress.completed} / {learning.progress.total} {en ? "completed" : "已完成"}</p>
    {learning.progress.total === 0 && <p>{en ? "No published lessons yet. Content is being prepared." : "尚未有已發布單元，內容準備中。"}</p>}
    {(query.isError || complete.error) && <div role="alert" className="space-y-2 border-2 border-[var(--color-ink)] p-3">
      <p>{complete.error instanceof ApiError && complete.error.status === 409
        ? en ? "This lesson version changed. Your earlier completion is preserved; reload before retrying." : "單元版本已更新，舊完成紀錄仍保留；請重新載入後再試。"
        : en ? "Learning could not be updated. The last loaded content is shown; completion has not been confirmed." : "暫時無法更新學習資料，以下保留上次載入內容；尚未確認完成。"}</p>
      <button onClick={refresh} className="underline">{en ? "Reload lessons" : "重新載入單元"}</button>
    </div>}
    {learning.lessons.map(lesson => <article key={`${lesson.id}:${lesson.contentVersion}`} className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-4">
      <h3 className="font-heading font-bold">{lesson.title} <span className="text-xs">v{lesson.contentVersion}</span></h3>
      <Markdown source={lesson.body} />
      {lesson.completed ? <p>{en ? "Completed" : "已完成"} · {lesson.completedAt}</p> : <button
        disabled={complete.isPending || query.isFetching || Boolean(complete.error) || query.isError}
        className="btn-primary disabled:opacity-50" onClick={() => complete.mutate(lesson)}>{en ? "Mark complete" : "標記完成"}</button>}
    </article>)}
    {learning.history.length > 0 && <details><summary>{en ? "Completion history" : "完成紀錄"}</summary><ul>
      {learning.history.map(row => <li key={`${row.lessonId}:${row.contentVersion}`}>v{row.contentVersion} · {row.completedAt}</li>)}
    </ul></details>}
  </section>;
}
