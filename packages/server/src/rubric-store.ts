import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { parseRubric, type Rubric } from "@reason/core";
import { blind75Order, titleForSlug, topicForSlug } from "./track-store.js";

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

const rubrics = new Map<string, Rubric>();

export function loadRubrics(): void {
  rubrics.clear();
  const files = fs.readdirSync(RUBRICS_DIR).filter((f) => f.endsWith(".yaml"));

  for (const file of files) {
    const raw = fs.readFileSync(path.join(RUBRICS_DIR, file), "utf-8");
    const data = yaml.load(raw);
    const rubric = parseRubric(data);
    rubrics.set(rubric.problem_id, rubric);
  }
}

export function getRubric(slug: string): Rubric | undefined {
  return rubrics.get(slug);
}

export function listProblems(): ProblemSummary[] {
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
