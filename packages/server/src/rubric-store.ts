import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { parseRubric, type Rubric } from "@reason/core";
import {
  getCachedRubric,
  listCachedProblems,
} from "./catalog-cache.js";
import { titleForSlug, topicForSlug, blind75Order } from "./track-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUBRICS_DIR = path.resolve(__dirname, "../../../rubrics");

export interface ProblemSummary {
  slug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  title?: string;
  topic?: string;
}

let yamlFallback = false;
const rubrics = new Map<string, Rubric>();

export function loadRubricsFromYaml(): Map<string, Rubric> {
  const loaded = new Map<string, Rubric>();
  const files = fs.readdirSync(RUBRICS_DIR).filter((f) => f.endsWith(".yaml"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(RUBRICS_DIR, file), "utf-8");
    const data = yaml.load(raw);
    const rubric = parseRubric(data);
    loaded.set(rubric.problem_id, rubric);
  }
  return loaded;
}

/** Local/dev fallback when Mongo catalog is unavailable. */
export function loadRubrics(): void {
  rubrics.clear();
  for (const [id, rubric] of loadRubricsFromYaml()) {
    rubrics.set(id, rubric);
  }
  yamlFallback = true;
}

export function getRubric(slug: string): Rubric | undefined {
  if (!yamlFallback) return getCachedRubric(slug);
  return rubrics.get(slug) ?? getCachedRubric(slug);
}

export function listProblems(): ProblemSummary[] {
  if (!yamlFallback) return listCachedProblems();

  const order = blind75Order();
  const rank = new Map(order.map((slug, index) => [slug, index]));
  return Array.from(rubrics.values())
    .map((r) => ({
      slug: r.problem_id,
      pattern: r.pattern,
      difficulty: r.difficulty,
      coreAsk: r.core_ask,
      title: titleForSlug(r.problem_id),
      topic: topicForSlug(r.problem_id),
    }))
    .sort((a, b) => {
      const aRank = rank.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.slug.localeCompare(b.slug);
    });
}

export function useYamlCatalogFallback(): boolean {
  return yamlFallback;
}

export function clearYamlCatalogFallback(): void {
  yamlFallback = false;
  rubrics.clear();
}
