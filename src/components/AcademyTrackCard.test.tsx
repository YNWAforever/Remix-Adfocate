import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
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
  title: "直播帶貨",
  level: "L2+",
  requiredLevel: "L2",
  duration: "20 min",
  color: "yellow",
  emoji: "📈",
  description: "x",
  teaserKey: "app.guide.teaser.a3",
};

function renderCard(effective: string) {
  return render(
    <I18nProvider>
      <AcademyTrackCard track={track} effectiveLevel={effective} />
    </I18nProvider>,
  );
}

describe("AcademyTrackCard", () => {
  it("shows a lock + unlock label when above effective level", () => {
    renderCard("L1");
    expect(screen.getByText(/🔒|解鎖/)).toBeInTheDocument();
  });
  it("is an active link when unlocked", () => {
    const { container } = renderCard("L3");
    expect(container.querySelector('a[href="/guide/track/a3"]')).not.toBeNull();
  });
});
