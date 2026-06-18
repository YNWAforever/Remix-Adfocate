import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, NotebookPen, ShieldCheck, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { OperatorAuthGate } from "@/components/operator/OperatorAuthGate";
import {
  RiskBadge,
  ReviewBadge,
  ShortlistBadge,
  SocialSyncBadge,
} from "@/components/operator/OperatorBadges";
import { ReviewActionPanel } from "@/components/operator/ReviewActionPanel";
import {
  fetchCreatorDetail,
  getAdminSecret,
  postCreatorNote,
  type AdminNoteCategory,
} from "@/lib/admin";

export const Route = createFileRoute("/operator/creators/$creatorId")({
  component: OperatorCreatorDetailRoute,
});

const numberFormatter = new Intl.NumberFormat("en-US");

function formatCount(value: number | null | undefined, suffix: string) {
  if (typeof value !== "number") {
    return null;
  }
  return `${numberFormatter.format(value)} ${suffix}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number") {
    return null;
  }
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "No record";
  }
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function maybeRecord(value: unknown) {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function OperatorCreatorDetailRoute() {
  const { creatorId } = Route.useParams();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [noteBody, setNoteBody] = useState("");

  const detail = useQuery({
    queryKey: ["admin-creator-detail", creatorId],
    enabled: !!secret,
    retry: false,
    queryFn: () => fetchCreatorDetail(creatorId),
  });

  const noteMutation = useMutation({
    mutationFn: (body: { category: AdminNoteCategory; body: string }) => postCreatorNote(creatorId, body),
    onSuccess: async () => {
      setNoteBody("");
      await queryClient.invalidateQueries({ queryKey: ["admin-creator-detail", creatorId] });
    },
  });

  const creator = detail.data?.creator;
  const detailData = detail.data;
  const review = detail.data?.review;
  const selectedSocial = detail.data?.socialAccounts[0] ?? null;
  const selectedAvatar = detailData?.profileMedia.avatarUrl ?? null;
  const unselectedSocialAvatar = selectedSocial?.external_avatar_url ?? null;

  const scoreEntries = useMemo(() => {
    if (!creator) {
      return [];
    }
    return Object.entries(creator.scores).filter(([, value]) => typeof value === "number") as Array<[string, number]>;
  }, [creator]);

  return (
    <OperatorAuthGate error={detail.error} onSecretChange={setSecret}>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold">創作者詳情</h1>
              {review ? <ReviewBadge status={review.status} /> : null}
              {review ? <RiskBadge risk={review.riskLevel} /> : null}
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">營運用創作者檔案、審核紀錄與內部備註。</p>
          </div>
          <Link
            to="/operator/creators"
            className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold"
          >
            <ArrowLeft className="h-4 w-4" />
            返回佇列
          </Link>
        </div>

        {detail.isLoading ? <p className="text-sm">載入中…</p> : null}

        {creator && review && detailData ? (
          <>
            <section className="grid gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div className="space-y-4">
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)]">
                    {selectedAvatar ? (
                      <img src={selectedAvatar} alt="Selected profile avatar" className="h-full w-full object-cover" />
                    ) : (
                      <UserRound className="h-8 w-8" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-heading text-2xl font-bold">{creator.display_name ?? "Unknown creator"}</h2>
                      <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                        {creator.level}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-soft-ink)]">
                      {creator.categories.join(", ") || "No categories"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <SocialSyncBadge label={detailData.social.label} />
                      <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                        {detailData.social.ownershipLabel}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-soft-ink)]">
                      Last reviewed: {formatDateTime(review.lastReviewedAt)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    formatCount(detailData.social.followerCount, "followers"),
                    formatPercent(detailData.social.engagementRate),
                    formatCount(selectedSocial?.avg_likes ?? null, "avg likes"),
                    formatCount(selectedSocial?.avg_comments ?? null, "avg comments"),
                    formatCount(selectedSocial?.freshness_score ?? null, "freshness"),
                  ]
                    .filter((value): value is string => !!value)
                    .map((value) => (
                      <div
                        key={value}
                        className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-3 py-2 text-sm font-bold"
                      >
                        {value}
                      </div>
                    ))}
                </div>

                <div className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    <h3 className="font-heading font-bold">Trust and passport scores</h3>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {scoreEntries.length > 0 ? (
                      scoreEntries.map(([key, value]) => (
                        <div key={key} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 text-sm">
                          <p className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">{key}</p>
                          <p className="font-heading text-lg font-bold">{numberFormatter.format(value)}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--color-soft-ink)]">No trust scores</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sky)] p-3">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" />
                  <h3 className="font-heading font-bold">Social preview</h3>
                </div>
                {selectedSocial ? (
                  <div className="space-y-2">
                    {unselectedSocialAvatar ? (
                      <div className="space-y-2 rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] bg-white px-3 py-2">
                        <p className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">
                          Unselected social-source avatar
                        </p>
                        <div className="flex items-center gap-3">
                          <img
                            src={unselectedSocialAvatar}
                            alt={`Unselected social avatar from ${selectedSocial.platform}`}
                            className="h-12 w-12 rounded-full border-2 border-[var(--color-ink)] object-cover"
                          />
                          <p className="text-sm text-[var(--color-soft-ink)]">
                            Review separately from the selected profile avatar.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <p className="font-bold">{selectedSocial.platform}</p>
                    <p className="text-sm text-[var(--color-soft-ink)]">{selectedSocial.handle ?? "No handle"}</p>
                    <p className="text-sm">{selectedSocial.bio ?? "No bio synced"}</p>
                    <p className="text-xs text-[var(--color-soft-ink)]">
                      API synced {formatDateTime(selectedSocial.api_synced_at)}
                    </p>
                    {selectedSocial.content_themes?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedSocial.content_themes.map((theme) => (
                          <span
                            key={theme}
                            className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold"
                          >
                            {theme}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-soft-ink)]">No synced social account</p>
                )}
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="space-y-4">
                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <h3 className="font-heading font-bold">Review status</h3>
                  <div className="flex flex-wrap gap-2">
                    <ReviewBadge status={review.status} />
                    <RiskBadge risk={review.riskLevel} />
                  </div>
                  <p className="text-sm">{review.summary?.trim() ? review.summary : "No review summary yet."}</p>
                  <dl className="grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2">
                      <dt className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">Reviewed by</dt>
                      <dd className="mt-1">{review.reviewedBy ?? "No reviewer recorded"}</dd>
                    </div>
                    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2">
                      <dt className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">Last reviewed</dt>
                      <dd className="mt-1">{formatDateTime(review.lastReviewedAt)}</dd>
                    </div>
                    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2">
                      <dt className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">Updated</dt>
                      <dd className="mt-1">{formatDateTime(review.updatedAt)}</dd>
                    </div>
                  </dl>
                </section>

                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <h3 className="font-heading font-bold">Profile media</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">
                      {detailData.profileMedia.completeness.score}% complete
                    </span>
                    <span className="text-sm text-[var(--color-soft-ink)]">
                      {detailData.profileMedia.portfolioLinks.length} portfolio links
                    </span>
                  </div>
                  <div className="space-y-2">
                    {detailData.profileMedia.portfolioLinks.length > 0 ? (
                      detailData.profileMedia.portfolioLinks.map((item) => (
                        <a
                          key={item.id}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">{item.title}</span>
                            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                              {item.platformType}
                            </span>
                            {item.publicHighlight ? (
                              <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">
                                Public highlight
                              </span>
                            ) : null}
                          </div>
                          {item.caption ? <p className="mt-2 text-[var(--color-soft-ink)]">{item.caption}</p> : null}
                        </a>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--color-soft-ink)]">No portfolio links</p>
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <h3 className="font-heading font-bold">Mission history</h3>
                  <div className="space-y-2">
                    {detailData.missionHistory.length > 0 ? (
                      detailData.missionHistory.map((entry, index) => (
                        <div
                          key={readString(entry, "id") ?? `mission-${index}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 text-sm"
                        >
                          <span>{readString(maybeRecord(entry.missions) ?? {}, "title") ?? "Untitled mission"}</span>
                          <span className="font-bold text-[var(--color-soft-ink)]">{readString(entry, "status") ?? "unknown"}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--color-soft-ink)]">No mission history</p>
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <div className="flex items-center gap-2">
                    <NotebookPen className="h-4 w-4" />
                    <h3 className="font-heading font-bold">Internal notes</h3>
                  </div>
                  <div className="space-y-2">
                    {detailData.notes.map((item) => (
                      <div key={item.id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">{item.category}</span>
                          <span className="text-xs text-[var(--color-soft-ink)]">{formatDateTime(item.created_at)}</span>
                        </div>
                        <p className="mt-2 text-sm">{item.body}</p>
                      </div>
                    ))}
                    {detailData.notes.length === 0 ? <p className="text-sm text-[var(--color-soft-ink)]">No internal notes</p> : null}
                  </div>
                  <div className="space-y-2">
                    <textarea
                      aria-label="New internal note"
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      rows={4}
                      className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3 text-sm outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Save internal note"
                      disabled={noteMutation.isPending || noteBody.trim().length === 0}
                      onClick={() => noteMutation.mutate({ category: "other", body: noteBody.trim() })}
                      className="inline-flex h-10 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 text-sm font-heading font-bold disabled:opacity-50"
                    >
                      Save note
                    </button>
                  </div>
                </section>
              </div>

              <div className="space-y-4">
                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <h3 className="font-heading font-bold">Review action</h3>
                  <ReviewActionPanel
                    creator={{
                      id: creator.id,
                      displayName: creator.display_name ?? "Unknown creator",
                      review,
                    }}
                    variant="full"
                    onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-creator-detail", creatorId] })}
                  />
                </section>

                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <h3 className="font-heading font-bold">Shortlist memberships</h3>
                  <div className="space-y-2">
                    {detailData.shortlists.length > 0 ? (
                      detailData.shortlists.map((item) => (
                        <div key={`${item.mission_id}-${item.status}`} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-bold">{item.mission_id}</span>
                            <ShortlistBadge status={item.status} />
                          </div>
                          <p className="mt-2 text-xs text-[var(--color-soft-ink)]">
                            {item.source} · updated {formatDateTime(item.updated_at)}
                          </p>
                          {item.notes ? <p className="mt-2 text-sm">{item.notes}</p> : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--color-soft-ink)]">No shortlist memberships</p>
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <h3 className="font-heading font-bold">Audit timeline</h3>
                  <div className="space-y-2">
                    {detailData.audit.length > 0 ? (
                      detailData.audit.map((entry, index) => {
                        const eventType = readString(entry, "event_type") ?? "unknown_event";
                        return (
                          <div
                            key={readString(entry, "id") ?? `audit-${index}`}
                            className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-bold">{eventType}</span>
                              <span className="text-xs text-[var(--color-soft-ink)]">{formatDateTime(readString(entry, "created_at"))}</span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-[var(--color-soft-ink)]">No audit events</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </OperatorAuthGate>
  );
}
