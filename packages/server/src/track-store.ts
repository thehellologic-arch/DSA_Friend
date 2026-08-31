import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { z } from "zod";
import {
  cachedBlind75Order,
  cachedTitleForSlug,
  cachedTopicForSlug,
  listCachedTracks,
} from "./catalog-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKS_DIR = path.resolve(__dirname, "../../../tracks");

const TrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  groups: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      problems: z.array(
        z.object({
          slug: z.string(),
          title: z.string(),
        }),
      ),
    }),
  ),
});

export type ProblemTrack = z.infer<typeof TrackSchema>;

let yamlFallback = false;
let tracks: ProblemTrack[] = [];

export function loadTracksFromYaml(): ProblemTrack[] {
  const loaded: ProblemTrack[] = [];
  if (!fs.existsSync(TRACKS_DIR)) return loaded;
  const files = fs.readdirSync(TRACKS_DIR).filter((f) => f.endsWith(".yaml"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(TRACKS_DIR, file), "utf-8");
    loaded.push(TrackSchema.parse(yaml.load(raw)));
  }
  return loaded;
}

/** Local/dev fallback when Mongo catalog is unavailable. */
export function loadTracks(): void {
  tracks = loadTracksFromYaml();
  yamlFallback = true;
}

export function listTracks(): ProblemTrack[] {
  if (!yamlFallback) return listCachedTracks();
  return tracks;
}

export function titleForSlug(slug: string): string | undefined {
  if (!yamlFallback) return cachedTitleForSlug(slug);
  for (const track of tracks) {
    for (const group of track.groups) {
      const hit = group.problems.find((problem) => problem.slug === slug);
      if (hit) return hit.title;
    }
  }
  return cachedTitleForSlug(slug);
}

export function topicForSlug(slug: string): string | undefined {
  if (!yamlFallback) return cachedTopicForSlug(slug);
  for (const track of tracks) {
    for (const group of track.groups) {
      if (group.problems.some((problem) => problem.slug === slug)) {
        return group.title;
      }
    }
  }
  return cachedTopicForSlug(slug);
}

export function blind75Order(): string[] {
  if (!yamlFallback) return cachedBlind75Order();
  const track = tracks.find((item) => item.id === "blind-75");
  if (!track) return cachedBlind75Order();
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

export function clearYamlTrackFallback(): void {
  yamlFallback = false;
  tracks = [];
}
