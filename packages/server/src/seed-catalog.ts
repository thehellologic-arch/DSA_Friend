import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: true,
});

import {
  ensureCatalogIndexes,
  getProblem,
  publishProblem,
  replaceTracks,
  upsertDraft,
} from "./catalog-repository.js";
import { closeMongo, isMongoConfigured } from "./mongo.js";
import { loadRubricsFromYaml } from "./rubric-store.js";
import { loadTracksFromYaml, titleForSlug, topicForSlug } from "./track-store.js";
import { loadTracks } from "./track-store.js";

async function main(): Promise<void> {
  if (!isMongoConfigured()) {
    throw new Error("MONGODB_URI is required to seed the catalog");
  }

  // Titles/topics come from YAML tracks during seed.
  loadTracks();
  await ensureCatalogIndexes();

  const rubrics = loadRubricsFromYaml();
  const trackList = loadTracksFromYaml();
  await replaceTracks(trackList);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const [id, rubric] of rubrics) {
    const existing = await getProblem(id);
    const title = titleForSlug(id);
    const topic = topicForSlug(id);

    if (!existing) {
      await upsertDraft({
        _id: id,
        pattern: rubric.pattern,
        difficulty: rubric.difficulty,
        coreAsk: rubric.core_ask,
        title,
        topic,
        status: "draft",
        rubric,
      });
      await publishProblem(id);
      inserted += 1;
      continue;
    }

    const sameBody =
      JSON.stringify(existing.rubric) ===
      JSON.stringify({
        ...rubric,
        problem_id: id,
        rubric_version: existing.rubric.rubric_version,
      });

    if (sameBody && existing.status === "published") {
      skipped += 1;
      continue;
    }

    await upsertDraft({
      _id: id,
      pattern: rubric.pattern,
      difficulty: rubric.difficulty,
      coreAsk: rubric.core_ask,
      title,
      topic,
      status: "draft",
      rubric: {
        ...rubric,
        rubric_version: existing.rubricVersion + 1,
      },
    });
    await publishProblem(id);
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tracks: trackList.length,
        inserted,
        updated,
        skipped,
        totalYaml: rubrics.size,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
