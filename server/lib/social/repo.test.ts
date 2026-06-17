import { describe, expect, it } from "vitest";
import { insertSnapshot, latestScanSnapshotAt, SOCIAL_SCAN_SNAPSHOT_RETENTION } from "./repo";
import type { SocialScanResult } from "./types";

const scanResult: SocialScanResult = {
  platform: "instagram",
  handle: "ming",
  profileUrl: "https://www.instagram.com/ming/",
  followerCount: 12000,
  followingCount: 321,
  postCount: 42,
  bio: "Beauty creator",
  externalAvatarUrl: "https://cdn.example.com/ming.jpg",
  engagementRate: 4.38,
  avgLikes: 500,
  avgComments: 25,
  postingFrequency: 2,
  freshnessScore: 100,
  contentThemes: ["beauty"],
  recentPostsSummary: [],
  summary: {
    postSampleSize: 0,
    hasRecentPosts: false,
    hasAvatar: true,
    hasBio: true,
  },
};

describe("social repo snapshot retention", () => {
  it("retains only the latest bounded snapshot window per account", async () => {
    const snapshots: Array<{ id: string; account_id: string; provider: string; status: string }> = [];
    let nextId = 1;

    const supabase = {
      from(table: string) {
        expect(table).toBe("creator_social_scan_snapshots");
        return {
          insert(row: { account_id: string; provider: string; status: string }) {
            snapshots.push({
              id: `snap-${nextId}`,
              account_id: row.account_id,
              provider: row.provider,
              status: row.status,
            });
            nextId += 1;
            return Promise.resolve({ error: null });
          },
          select() {
            return {
              eq(_column: string, accountId: string) {
                return {
                  order() {
                    return Promise.resolve({
                      data: snapshots
                        .filter((snapshot) => snapshot.account_id === accountId)
                        .slice()
                        .reverse()
                        .map((snapshot) => ({ id: snapshot.id })),
                      error: null,
                    });
                  },
                };
              },
            };
          },
          delete() {
            return {
              in(_column: string, ids: string[]) {
                for (const id of ids) {
                  const index = snapshots.findIndex((snapshot) => snapshot.id === id);
                  if (index >= 0) snapshots.splice(index, 1);
                }
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };

    for (let index = 0; index < SOCIAL_SCAN_SNAPSHOT_RETENTION + 2; index += 1) {
      await insertSnapshot(supabase as never, "acc-1", "rapidapi", "synced", scanResult);
    }

    expect(snapshots).toHaveLength(SOCIAL_SCAN_SNAPSHOT_RETENTION);
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(
      Array.from({ length: SOCIAL_SCAN_SNAPSHOT_RETENTION }, (_, index) => `snap-${index + 3}`),
    );
  });
});

describe("social repo latest snapshot lookup", () => {
  it("returns the latest snapshot scanned_at for an account", async () => {
    const supabase = {
      from(table: string) {
        expect(table).toBe("creator_social_scan_snapshots");
        return {
          select(columns: string) {
            expect(columns).toBe("scanned_at");
            return {
              eq(_column: string, accountId: string) {
                expect(accountId).toBe("acc-1");
                return {
                  order(column: string, input: { ascending: boolean }) {
                    expect(column).toBe("scanned_at");
                    expect(input).toEqual({ ascending: false });
                    return {
                      limit(count: number) {
                        expect(count).toBe(1);
                        return {
                          maybeSingle() {
                            return Promise.resolve({
                              data: { scanned_at: "2026-06-18T09:30:00.000Z" },
                              error: null,
                            });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    await expect(latestScanSnapshotAt(supabase as never, "acc-1")).resolves.toBe("2026-06-18T09:30:00.000Z");
  });
});
