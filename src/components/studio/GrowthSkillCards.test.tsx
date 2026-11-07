import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GROWTH_SKILLS } from "@/lib/creatorGrowth/skillManifest";
import { GrowthSkillCards } from "./GrowthSkillCards";

describe("GrowthSkillCards", () => {
  it("renders exactly four cards in the approved order with accurate provenance", () => {
    render(<GrowthSkillCards onChooseSkill={vi.fn()} />);

    const cards = screen.getAllByRole("button");
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.getAttribute("data-skill"))).toEqual(
      GROWTH_SKILLS.map((skill) => skill.id),
    );
    expect(screen.getByText("KOCmax 原創")).toBeInTheDocument();
    expect(screen.getAllByText("公開技能啟發 · MIT")).toHaveLength(3);
    expect(screen.getByText(/kocmax-image-diagnosis-v1/)).not.toBeVisible();
    expect(screen.queryByText(/content-audit/)).not.toBeVisible();
    expect(screen.getAllByText("來源說明")).toHaveLength(4);
    expect(screen.getAllByText(/Frank Heijdenrijk 2026/)).toHaveLength(3);
    const cardsWithDisclosures = document.querySelectorAll(".s-growth-card");
    expect(cardsWithDisclosures[0].querySelector("button details")).toBeNull();
    expect(cardsWithDisclosures[0].querySelector("button button")).toBeNull();
  });

  it("keeps full native and curated provenance in accessible disclosures", () => {
    render(<GrowthSkillCards onChooseSkill={vi.fn()} />);
    const summaries = screen.getAllByText("來源說明");

    fireEvent.click(summaries[0]);
    expect(screen.getByText(/kocmax-image-diagnosis-v1/)).toBeVisible();

    fireEvent.click(summaries[1]);
    const curatedSource = document.querySelector(
      ".s-growth-card:nth-child(2) .s-growth-card-source[open]",
    );
    expect(curatedSource).toHaveTextContent(
      "https://github.com/social-media-skills/skills",
    );
    expect(curatedSource).toHaveTextContent(
      "f28cef2b7067ec64e79c9d85421c022c06659e03",
    );
  });

  it("selects only the activated card and keeps every card keyboard reachable", () => {
    const choose = vi.fn();
    render(
      <GrowthSkillCards
        onChooseSkill={choose}
        selectedSkillId="next_caption"
      />,
    );

    const caption = screen.getByRole("button", { name: /寫下一篇文案/ });
    expect(caption).toHaveAttribute("aria-pressed", "true");
    expect(caption).toHaveAttribute("type", "button");
    caption.focus();
    expect(caption).toHaveFocus();
    fireEvent.keyDown(caption, { key: "Enter", code: "Enter" });
    fireEvent.click(caption);

    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith("next_caption");
  });
});
