import type { Rubric } from "@reason/core";
import {
  listPublishedProblems,
  listTracksFromDb,
} from "./catalog-repository.js";
import type { ProblemSummary } from "./rubric-store.js";
import type { ProblemTrack } from "./track-store.js";

interface CatalogSnapshot {
  rubrics: Map<string, Rubric>;
  problems: ProblemSummary[];
  tracks: ProblemTrack[];
  loadedAt: string;
}

let snapshot: CatalogSnapshot = {
  rubrics: new Map(),
  problems: [],
  tracks: [],
  loadedAt: new Date(0).toISOString(),
};

function sortByTrack(
  problems: ProblemSummary[],
  trackList: ProblemTrack[],
): ProblemSummary[] {
  const blind = trackList.find((t) => t.id === "blind-75");
  const order: string[] = [];
  const seen = new Set<string>();
  if (blind) {
    for (const group of blind.groups) {
      for (const problem of group.problems) {
        if (seen.has(problem.slug)) continue;
        seen.add(problem.slug);
        order.push(problem.slug);
      }
    }
  }
  const rank = new Map(order.map((slug, index) => [slug, index]));
  return [...problems].sort((a, b) => {
    const aRank = rank.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.slug.localeCompare(b.slug);
  });
}

function titleAndTopicMaps(trackList: ProblemTrack[]): {
  titles: Map<string, string>;
  topics: Map<string, string>;
} {
  const titles = new Map<string, string>();
  const topics = new Map<string, string>();
  for (const track of trackList) {
    for (const group of track.groups) {
      for (const problem of group.problems) {
        if (!titles.has(problem.slug)) titles.set(problem.slug, problem.title);
        if (!topics.has(problem.slug)) topics.set(problem.slug, group.title);
      }
    }
  }
  return { titles, topics };
}

export async function loadCatalogCache(): Promise<{
  problems: number;
  tracks: number;
  loadedAt: string;
}> {
  const docs = await listPublishedProblems();
  const trackDocs = await listTracksFromDb();
  const trackList: ProblemTrack[] = trackDocs.map(
    ({ updatedAt: _updatedAt, ...track }) => track,
  );
  const { titles, topics } = titleAndTopicMaps(trackList);
  const rubrics = new Map(docs.map((d) => [d._id, d.rubric]));
  const problems: ProblemSummary[] = docs.map((d) => ({
    slug: d._id,
    pattern: d.pattern,
    difficulty: d.difficulty,
    coreAsk: d.coreAsk,
    title: d.title ?? titles.get(d._id),
    topic: d.topic ?? topics.get(d._id),
  }));
  const loadedAt = new Date().toISOString();
  snapshot = {
    rubrics,
    problems: sortByTrack(problems, trackList),
    tracks: trackList,
    loadedAt,
  };
  return {
    problems: snapshot.problems.length,
    tracks: snapshot.tracks.length,
    loadedAt,
  };
}

/** Test/helper: replace cache without Mongo (build-then-swap). */
export function replaceCatalogSnapshot(next: {
  rubrics: Map<string, Rubric>;
  problems: ProblemSummary[];
  tracks: ProblemTrack[];
}): void {
  snapshot = {
    rubrics: next.rubrics,
    problems: next.problems,
    tracks: next.tracks,
    loadedAt: new Date().toISOString(),
  };
}

export function getCatalogLoadedAt(): string {
  return snapshot.loadedAt;
}

export function getCachedRubric(slug: string): Rubric | undefined {
  return snapshot.rubrics.get(slug);
}

export function listCachedProblems(): ProblemSummary[] {
  return snapshot.problems;
}

export function listCachedTracks(): ProblemTrack[] {
  return snapshot.tracks;
}

export function cachedTitleForSlug(slug: string): string | undefined {
  for (const track of snapshot.tracks) {
    for (const group of track.groups) {
      const hit = group.problems.find((problem) => problem.slug === slug);
      if (hit) return hit.title;
    }
  }
  return undefined;
}

export function cachedTopicForSlug(slug: string): string | undefined {
  for (const track of snapshot.tracks) {
    for (const group of track.groups) {
      if (group.problems.some((problem) => problem.slug === slug)) {
        return group.title;
      }
    }
  }
  return undefined;
}

export function cachedBlind75Order(): string[] {
  const track = snapshot.tracks.find((item) => item.id === "blind-75");
  if (!track) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const group of track.groups) {
    for (const problem of group.problems) {
      if (seen.has(problem.slug)) continue;
      seen.add(problem.slug);
      order.push(problem.slug);
    }
  }
  return order;
}
