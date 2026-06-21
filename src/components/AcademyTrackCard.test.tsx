import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AcademyTrackCard } from "./AcademyTrackCard";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: (p: { children: React.ReactNode; to: string; params?: Record<string, string>; className?: string }) => {
      const href = p.to.replace(/\$(\w+)/g, (_, k) => p.params?.[k] ?? k);
      return <a href={href} className={p.className}>{p.children}</a>;
    },
  };
});

const track = {
  id: "a3",
  title: { en: "Live Commerce", zh: "直播帶貨" },
  level: "L2+",
  requiredLevel: "L2",
  duration: { en: "20 min", zh: "20 分鐘" },
  color: "yellow",
  emoji: "📈",
  description: { en: "x", zh: "x" },
  teaserKey: "app.guide.teaser.a3",
};

function renderCard(creatorLevel: string, isTrusted: boolean) {
  // No I18nProvider → default i18n context (zh), matching the other guide tests.
  return render(
    <AcademyTrackCard track={track} creatorLevel={creatorLevel} isTrusted={isTrusted} />,
  );
}

describe("AcademyTrackCard", () => {
  it("shows a lock + 'unlock at' label when under-levelled (need more XP)", () => {
    renderCard("L1", false);
    expect(screen.getByText(/🔒/)).toBeInTheDocument();
    expect(screen.getByText(/解鎖/)).toBeInTheDocument();
  });

  it("is an active link to the track when unlocked (level met + trusted)", () => {
    const { container } = renderCard("L3", true);
    expect(container.querySelector('a[href="/guide/track/a3"]')).not.toBeNull();
  });

  it("links to /profile with verify copy when XP is met but unverified", () => {
    const { container } = renderCard("L2", false);
    // verification is the only remaining gate → card points at /profile
    expect(container.querySelector('a[href="/profile"]')).not.toBeNull();
    expect(screen.getByText(/驗證社交帳號/)).toBeInTheDocument();
  });
});
