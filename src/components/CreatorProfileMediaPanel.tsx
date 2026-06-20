import { useMemo, useState } from "react";
import { ExternalLink, Pencil, Star, Trash2, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import {
  type ProfileMediaLink,
  type PortfolioPlatformType,
  useCreateAvatarUpload,
  useCreatePortfolioLink,
  useDeletePortfolioLink,
  useProfileMedia,
  usePublishProfileMedia,
  useSelectUploadedAvatar,
  useUpdatePortfolioLink,
} from "@/lib/queries/kocmax";

// Platform labels are brand names — not translated. Only the non-brand labels are localised below.
const PLATFORM_OPTIONS_VALUES: Array<{ value: PortfolioPlatformType; enLabel: string }> = [
  { value: "instagram", enLabel: "Instagram" },
  { value: "threads", enLabel: "Threads" },
  { value: "tiktok", enLabel: "TikTok" },
  { value: "youtube", enLabel: "YouTube" },
  { value: "website", enLabel: "Website" },
  { value: "case_study", enLabel: "Case study" },
  { value: "other", enLabel: "Other" },
];

export function CreatorProfileMediaPanel() {
  const { t } = useI18n();
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editPlatformType, setEditPlatformType] = useState<PortfolioPlatformType>("website");
  const [editCaption, setEditCaption] = useState("");
  const [editSortOrder, setEditSortOrder] = useState("0");
  const [pendingHighlightIds, setPendingHighlightIds] = useState<string[]>([]);
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);

  const platformOptions = useMemo<Array<{ value: PortfolioPlatformType; label: string }>>(
    () => PLATFORM_OPTIONS_VALUES.map((o) => ({ value: o.value, label: o.enLabel })),
    [],
  );

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
    setMessage(t("app.media.avatarUpdated"));
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

  function beginEdit(link: ProfileMediaLink) {
    setEditingId(link.id);
    setEditTitle(link.title);
    setEditUrl(link.url);
    setEditPlatformType(link.platformType);
    setEditCaption(link.caption ?? "");
    setEditSortOrder(String(link.sortOrder));
    setMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditUrl("");
    setEditPlatformType("website");
    setEditCaption("");
    setEditSortOrder("0");
  }

  async function saveEdit(linkId: string) {
    setMessage(null);
    setSavingLinkId(linkId);
    try {
      await updateLink.mutateAsync({
        id: linkId,
        patch: {
          title: editTitle.trim(),
          url: editUrl.trim(),
          platform_type: editPlatformType,
          caption: editCaption.trim(),
          sort_order: Number.parseInt(editSortOrder, 10) || 0,
        },
      });
      cancelEdit();
    } finally {
      setSavingLinkId(null);
    }
  }

  async function toggleHighlight(link: ProfileMediaLink) {
    const isEnabling = !link.publicHighlight;
    if (isEnabling && selectedHighlights + pendingHighlightIds.length >= 3) {
      setMessage(t("app.media.highlightCap"));
      return;
    }

    if (isEnabling) {
      setPendingHighlightIds((current) => (current.includes(link.id) ? current : [...current, link.id]));
    }

    try {
      await updateLink.mutateAsync({ id: link.id, patch: { public_highlight: !link.publicHighlight } });
      setMessage(null);
    } catch {
      setMessage(t("app.media.highlightError"));
    } finally {
      if (isEnabling) {
        setPendingHighlightIds((current) => current.filter((id) => id !== link.id));
      }
    }
  }

  async function removeLink(linkId: string) {
    setMessage(null);
    setDeletingLinkId(linkId);
    try {
      await deleteLink.mutateAsync(linkId);
    } catch {
      setMessage(t("app.media.deleteError"));
    } finally {
      setDeletingLinkId(null);
    }
  }

  if (media.isLoading) {
    return (
      <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <h2 className="font-heading font-bold">{t("app.media.heading")}</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</p>
      </section>
    );
  }

  if (media.isError || !media.data) {
    return (
      <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <h2 className="font-heading font-bold">{t("app.media.heading")}</h2>
        <p className="text-sm text-[var(--color-magenta)]">{t("app.media.loadFailed")}</p>
      </section>
    );
  }

  const selectedHighlights = media.data.portfolioLinks.filter((link) => link.publicHighlight).length;

  return (
    <section className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading font-bold">{t("app.media.heading")}</h2>
        <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">
          {media.data.completeness.score}%
        </span>
      </div>

      {message ? <p className="text-sm font-medium text-[var(--color-soft-ink)]">{message}</p> : null}

      <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-heading font-bold">
        <Upload className="h-4 w-4" />
        {t("app.media.uploadAvatar")}
        <input
          aria-label={t("app.media.uploadAvatar")}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void uploadAvatar(file).catch(() => setMessage(t("app.media.avatarUploadError")));
          }}
        />
      </label>

      <div className="grid gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label={t("app.media.workTitle")}
          placeholder={t("app.media.workTitle")}
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-label={t("app.media.workUrl")}
          placeholder="https://example.com/work"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <select
          value={platformType}
          onChange={(event) => setPlatformType(event.target.value as PortfolioPlatformType)}
          aria-label={t("app.media.workType")}
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        >
          {platformOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          aria-label={t("app.media.workCaption")}
          placeholder={t("app.media.workCaption")}
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <button
          type="button"
          aria-label={t("app.media.addWork")}
          disabled={!title.trim() || !url.trim() || createLink.isPending}
          onClick={() => void submitLink().catch(() => setMessage(t("app.media.addError")))}
          className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50"
        >
          {t("app.media.addWork")}
        </button>
      </div>

      <div className="space-y-2">
        {media.data.portfolioLinks.map((link) => {
          const pendingEnable = pendingHighlightIds.includes(link.id);
          const effectivePublicHighlight = link.publicHighlight || pendingEnable;
          const highlightDisabled = !link.publicHighlight && selectedHighlights + pendingHighlightIds.length >= 3 && !pendingEnable;
          const isEditing = editingId === link.id;
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
                  aria-label={t("app.media.editWorkAria", { title: link.title })}
                  disabled={isEditing && savingLinkId === link.id}
                  onClick={() => beginEdit(link)}
                  className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4" />
                  {t("app.media.editBtn")}
                </button>
                <button
                  type="button"
                  aria-label={t("app.media.toggleHighlightAria", { title: link.title })}
                  aria-pressed={effectivePublicHighlight}
                  disabled={highlightDisabled}
                  onClick={() => void toggleHighlight(link)}
                  className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold disabled:opacity-50"
                >
                  <Star className="h-4 w-4" />
                  {effectivePublicHighlight ? t("app.media.highlighted") : t("app.media.setPublic")}
                </button>
                <button
                  type="button"
                  aria-label={t("app.media.deleteWorkAria", { title: link.title })}
                  disabled={deletingLinkId === link.id}
                  onClick={() => void removeLink(link.id)}
                  className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold text-[var(--color-magenta)] disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("app.media.deleteBtn")}
                </button>
              </div>
              {isEditing ? (
                <div className="mt-3 grid gap-2 border-t-2 border-[var(--color-ink)] pt-3">
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    aria-label={t("app.media.editTitleAria", { title: link.title })}
                    className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm"
                  />
                  <input
                    value={editUrl}
                    onChange={(event) => setEditUrl(event.target.value)}
                    aria-label={t("app.media.editUrlAria", { title: link.title })}
                    className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm"
                  />
                  <select
                    value={editPlatformType}
                    onChange={(event) => setEditPlatformType(event.target.value as PortfolioPlatformType)}
                    aria-label={t("app.media.editTypeAria", { title: link.title })}
                    className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm"
                  >
                    {platformOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={editCaption}
                    onChange={(event) => setEditCaption(event.target.value)}
                    aria-label={t("app.media.editCaptionAria", { title: link.title })}
                    className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={editSortOrder}
                    onChange={(event) => setEditSortOrder(event.target.value)}
                    aria-label={t("app.media.editSortAria", { title: link.title })}
                    className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={t("app.media.saveWorkAria", { title: link.title })}
                      disabled={!editTitle.trim() || !editUrl.trim() || savingLinkId === link.id}
                      onClick={() => void saveEdit(link.id).catch(() => setMessage(t("app.media.updateError")))}
                      className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 text-sm font-heading font-bold disabled:opacity-50"
                    >
                      {t("app.media.saveBtn")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("app.media.cancelEditAria", { title: link.title })}
                      disabled={savingLinkId === link.id}
                      onClick={cancelEdit}
                      className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label={t("app.media.publishBtn")}
        disabled={publish.isPending}
        onClick={() => void publish.mutateAsync().then(() => setMessage(t("app.media.publishSuccess"))).catch(() => setMessage(t("app.media.publishError")))}
        className="w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50"
      >
        {t("app.media.publishBtn")}
      </button>
    </section>
  );
}
