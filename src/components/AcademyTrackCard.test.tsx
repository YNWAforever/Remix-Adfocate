import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { AcademyTrackCard } from "./AcademyTrackCard";

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
