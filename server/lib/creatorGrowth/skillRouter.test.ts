import { describe, expect, expectTypeOf, it } from "vitest";

import {
  GROWTH_SKILLS,
  GROWTH_SKILL_SOURCE,
  type GrowthSkillProvenance,
  type GrowthSkillId,
} from "../../../src/lib/creatorGrowth/skillManifest.js";
import { routeGrowthQuestion } from "./skillRouter.js";

const SOURCE_REVISION = "f28cef2b7067ec64e79c9d85421c022c06659e03";

describe("GROWTH_SKILLS", () => {
  it("publishes exactly the four approved cards in review order", () => {
    expect(GROWTH_SKILLS.map((skill) => skill.id)).toEqual([
      "image_diagnosis",
      "post_review",
      "next_caption",
      "next_growth_step",
    ]);
  });

  it("keeps each card short, friendly, and source-aware", () => {
    for (const skill of GROWTH_SKILLS) {
      expect(skill.titleZh).toMatch(/[\u3400-\u9fff]/);
      expect(Array.from(skill.titleZh).length).toBeLessThanOrEqual(10);
      expect(skill.difficulty.trim()).not.toBe("");
      expect(Number.isInteger(skill.estimatedMinutes)).toBe(true);
      expect(skill.estimatedMinutes).toBeGreaterThan(0);
      expect(skill.requiredSources.length).toBeGreaterThan(0);
      expect(skill.requiredSources.every((source) => source.trim().length > 0)).toBe(true);
      expect(skill.reward).toBe("none");
    }
  });

  it("keeps native image diagnosis free of external source attribution", () => {
    const imageDiagnosis = GROWTH_SKILLS.find((skill) => skill.id === "image_diagnosis");
    if (imageDiagnosis?.provenance.kind !== "native") {
      throw new Error("image diagnosis must use native provenance");
    }
    const implementationVersion: string = imageDiagnosis.provenance.implementationVersion;
    const nativeProvenance: GrowthSkillProvenance = imageDiagnosis.provenance;

    expect(nativeProvenance).toEqual({
      kind: "native",
      implementationVersion: "kocmax-image-diagnosis-v1",
    });
    expect(implementationVersion).toBe("kocmax-image-diagnosis-v1");
    expect(JSON.stringify(imageDiagnosis.provenance)).not.toMatch(
      /social-media-skills|f28cef2b|MIT|Frank Heijdenrijk|image-prompt/i,
    );
  });

  it("attaches curated source metadata only to externally derived cards", () => {
    const expectedSourceSkills = new Map<GrowthSkillId, readonly string[]>([
      ["post_review", ["content-audit", "analytics-and-reporting"]],
      ["next_caption", ["caption-writer", "hook-writer"]],
      ["next_growth_step", ["instagram-growth"]],
    ]);

    for (const skill of GROWTH_SKILLS.filter((card) => card.id !== "image_diagnosis")) {
      if (skill.provenance.kind !== "curated_external") {
        throw new Error(`${skill.id} must use curated external provenance`);
      }
      const sourceSkills: readonly string[] = skill.provenance.sourceSkills;
      expect(skill.provenance).toMatchObject({
        ...GROWTH_SKILL_SOURCE,
        kind: "curated_external",
        sourceSkills: expectedSourceSkills.get(skill.id),
      });
      expect(sourceSkills).toEqual(expectedSourceSkills.get(skill.id));
      expect(Object.isFrozen(skill.provenance)).toBe(true);
      expect(Object.isFrozen(skill.provenance.sourceSkills)).toBe(true);
    }
  });

  it("stores attribution as inert metadata without executable or rewarded actions", () => {
    expect(GROWTH_SKILL_SOURCE).toEqual({
      repository: "https://github.com/social-media-skills/skills",
      revision: SOURCE_REVISION,
      license: "MIT",
      attribution: "Frank Heijdenrijk 2026",
    });
    expect(JSON.stringify(GROWTH_SKILLS)).not.toMatch(
      /WoopSocial|instagram_business_content_publish|native[-_ ]?publish|points?|XP/i,
    );
    expect(Object.isFrozen(GROWTH_SKILLS)).toBe(true);
    expect(GROWTH_SKILLS.every(Object.isFrozen)).toBe(true);
  });
});

describe("routeGrowthQuestion", () => {
  it.each([
    ["幫我睇下呢張相片嘅構圖有咩問題", "image_diagnosis"],
    ["Review the composition and OCR in this photo", "image_diagnosis"],
    ["幫我檢討上次篇貼文嘅表現", "post_review"],
    ["Audit the metrics and reach of my latest post", "post_review"],
    ["幫我寫下一篇 caption 嘅開頭", "next_caption"],
    ["Draft hooks for my next caption", "next_caption"],
    ["我下一步可以做咩成長實驗", "next_growth_step"],
    ["What should I test next to grow my audience?", "next_growth_step"],
  ] as const)("routes a clear request: %s", (question, expected) => {
    expect(routeGrowthQuestion(question)).toBe(expected);
  });

  it.each([
    ["幫我睇下呢張圖片同上次篇貼文", null],
    ["幫我檢討 caption 嘅表現", null],
    ["圖片同文案一齊幫我寫", null],
    ["幫我發佈呢張圖片同貼文", null],
    ["Write and publish my next caption", null],
    ["Improve this caption and queue it", null],
    ["Improve this caption after it is queued", null],
    ["Improve this caption while queueing it", null],
    ["Improve this caption while queuing it", null],
    ["Improve this caption and enqueue it", null],
    ["Improve this caption after it is enqueued", null],
    ["Improve this caption when the system enqueues it", null],
    ["Improve this caption while enqueuing it", null],
    ["Improve this caption while enqueueing it", null],
    ["幫我寫 caption 然後排隊出貼文", null],
    ["把這篇貼文加入待發隊列", null],
    ["Schedule this post for tomorrow", null],
    ["今天想輕鬆傾下計", null],
    ["   ", null],
  ] as const)("leaves conservative or ordinary chat in normal chat: %s", (question, expected) => {
    expect(routeGrowthQuestion(question)).toBe(expected);
  });

  it("returns only a skill id or null", () => {
    expectTypeOf(routeGrowthQuestion("幫我睇相")).toEqualTypeOf<GrowthSkillId | null>();
  });
});
