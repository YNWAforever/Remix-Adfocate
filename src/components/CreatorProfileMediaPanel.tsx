import { useState } from "react";
import { ExternalLink, Star, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  type PortfolioPlatformType,
  useCreateAvatarUpload,
  useCreatePortfolioLink,
  useDeletePortfolioLink,
  useProfileMedia,
  usePublishProfileMedia,
  useSelectUploadedAvatar,
  useUpdatePortfolioLink,
} from "@/lib/queries/kocmax";

const PLATFORM_OPTIONS: Array<{ value: PortfolioPlatformType; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "threads", label: "Threads" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "website", label: "Website" },
  { value: "case_study", label: "Case study" },
  { value: "other", label: "Other" },
];

export function CreatorProfileMediaPanel() {
  const media = useProfileMedia();
  const createUpload = useCreateAvatarUpload();
  const selectAvatar = useSelectUploadedAvatar();
  const createLink = useCreatePortfolioLink();
  const updateLink = useUpdatePortfolioLink();
  const deleteLink = useDeletePortfolioLink();
  const publish = usePublishProfileMedia();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [platformType, setPlatformType] = useState<PortfolioPlatformType>("website");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function uploadAvatar(file: File) {
    setMessage(null);
    const metadata = await createUpload.mutateAsync({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    const { error } = await supabase.storage
      .from(metadata.bucket)
      .upload(metadata.path, file, { contentType: metadata.contentType, upsert: false });
    if (error) throw error;
    await selectAvatar.mutateAsync(metadata.path);
    setMessage("頭像已更新，發佈後會顯示在公開護照");
  }

  async function submitLink() {
    setMessage(null);
    await createLink.mutateAsync({
      title: title.trim(),
      url: url.trim(),
      platform_type: platformType,
      caption,
      public_highlight: false,
    });
    setTitle("");
    setUrl("");
    setCaption("");
  }

  if (media.isLoading) {
    return (
      <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <h2 className="font-heading font-bold">創作者媒體</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </section>
    );
  }

  if (media.isError || !media.data) {
    return (
      <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <h2 className="font-heading font-bold">創作者媒體</h2>
        <p className="text-sm text-[var(--color-magenta)]">媒體資料載入失敗</p>
      </section>
    );
  }

  const selectedHighlights = media.data.portfolioLinks.filter((link) => link.publicHighlight).length;

  return (
    <section className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading font-bold">創作者媒體</h2>
        <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">
          {media.data.completeness.score}%
        </span>
      </div>

      {message ? <p className="text-sm font-medium text-[var(--color-soft-ink)]">{message}</p> : null}

      <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-heading font-bold">
        <Upload className="h-4 w-4" />
        上載頭像
        <input
          aria-label="上載頭像"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void uploadAvatar(file).catch(() => setMessage("頭像上載失敗"));
          }}
        />
      </label>

      <div className="grid gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="作品標題"
          placeholder="作品標題"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-label="作品連結"
          placeholder="https://example.com/work"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <select
          value={platformType}
          onChange={(event) => setPlatformType(event.target.value as PortfolioPlatformType)}
          aria-label="作品類型"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        >
          {PLATFORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          aria-label="作品說明"
          placeholder="作品說明"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <button
          type="button"
          aria-label="新增作品"
          disabled={!title.trim() || !url.trim() || createLink.isPending}
          onClick={() => void submitLink().catch(() => setMessage("作品新增失敗"))}
          className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50"
        >
          新增作品
        </button>
      </div>

      <div className="space-y-2">
        {media.data.portfolioLinks.map((link) => {
          const highlightDisabled = !link.publicHighlight && selectedHighlights >= 3;
          return (
            <div key={link.id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-heading font-bold">
                  {link.title}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                  {link.platformType}
                </span>
              </div>
              {link.caption ? <p className="mt-2 text-sm text-[var(--color-soft-ink)]">{link.caption}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label={`切換公開精選 ${link.title}`}
                  disabled={highlightDisabled || updateLink.isPending}
                  onClick={() =>
                    void updateLink
                      .mutateAsync({ id: link.id, patch: { public_highlight: !link.publicHighlight } })
                      .catch(() => setMessage("公開精選更新失敗"))
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold disabled:opacity-50"
                >
                  <Star className="h-4 w-4" />
                  {link.publicHighlight ? "公開精選" : "設為公開"}
                </button>
                <button
                  type="button"
                  aria-label={`刪除作品 ${link.title}`}
                  disabled={deleteLink.isPending}
                  onClick={() => void deleteLink.mutateAsync(link.id).catch(() => setMessage("作品刪除失敗"))}
                  className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold text-[var(--color-magenta)] disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  刪除
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="發佈到公開護照"
        disabled={publish.isPending}
        onClick={() => void publish.mutateAsync().then(() => setMessage("公開護照已更新")).catch(() => setMessage("發佈失敗"))}
        className="w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50"
      >
        發佈到公開護照
      </button>
    </section>
  );
}
