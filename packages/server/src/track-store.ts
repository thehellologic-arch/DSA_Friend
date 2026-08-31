import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { z } from "zod";

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

let tracks: ProblemTrack[] = [];

export function loadTracks(): void {
  tracks = [];
  if (!fs.existsSync(TRACKS_DIR)) return;
  const files = fs.readdirSync(TRACKS_DIR).filter((f) => f.endsWith(".yaml"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(TRACKS_DIR, file), "utf-8");
    tracks.push(TrackSchema.parse(yaml.load(raw)));
  }
}

export function listTracks(): ProblemTrack[] {
  return tracks;
}

export function titleForSlug(slug: string): string | undefined {
  for (const track of tracks) {
    for (const group of track.groups) {
      const hit = group.problems.find((problem) => problem.slug === slug);
      if (hit) return hit.title;
    }
  }
  return undefined;
}

export function topicForSlug(slug: string): string | undefined {
  for (const track of tracks) {
    for (const group of track.groups) {
      if (group.problems.some((problem) => problem.slug === slug)) {
        return group.title;
      }
    }
  }
  return undefined;
}

export function blind75Order(): string[] {
  const track = tracks.find((item) => item.id === "blind-75");
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
