import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type NewsData = { items: unknown[]; page: number; pageSize: number; total: number } | undefined;
type HoistedNews = { data: NewsData; isLoading: boolean };

const hoisted = vi.hoisted(() => ({
  news: {
    data: undefined as NewsData,
    isLoading: false,
  } as HoistedNews,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => hoisted.news,
  };
});

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

import { Route } from "./_app.news.index";

function renderFeed() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

describe("NewsFeed page", () => {
  beforeEach(() => {
    hoisted.news = { data: undefined, isLoading: false };
  });

  it("renders cards for returned items", () => {
    hoisted.news = {
      data: {
        items: [
          {
            id: "1",
            slug: "summer-sunscreen",
            kind: "article",
            title: "夏日防曬攻略",
            excerpt: null,
            coverImageUrl: null,
            category: null,
            tags: [],
            publishedAt: null,
            pinned: false,
            views: 0,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      isLoading: false,
    };
    renderFeed();
    expect(screen.getByText("夏日防曬攻略")).toBeInTheDocument();
  });

  it("shows the empty state when there are no items", () => {
    hoisted.news = { data: { items: [], page: 1, pageSize: 20, total: 0 }, isLoading: false };
    renderFeed();
    expect(screen.getByText(/暫時未有內容|Nothing here/)).toBeInTheDocument();
  });
});
