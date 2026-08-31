import { parseRubric, type Rubric } from "@reason/core";
import type { Collection, Db } from "mongodb";
import { getDb } from "./mongo.js";
import type {
  ProblemDoc,
  ProblemStatus,
  RubricRevisionDoc,
  TrackDoc,
  UpsertDraftInput,
} from "./catalog-types.js";
import type { ProblemTrack } from "./track-store.js";

function problems(db: Db): Collection<ProblemDoc> {
  return db.collection<ProblemDoc>("problems");
}

function revisions(db: Db): Collection<RubricRevisionDoc> {
  return db.collection<RubricRevisionDoc>("rubric_revisions");
}

function tracks(db: Db): Collection<TrackDoc> {
  return db.collection<TrackDoc>("tracks");
}

export async function ensureCatalogIndexes(): Promise<void> {
  const db = await getDb();
  await problems(db).createIndexes([
    { key: { status: 1, pattern: 1, difficulty: 1 } },
    { key: { status: 1, updatedAt: -1 } },
  ]);
  await revisions(db).createIndexes([
    { key: { problemId: 1, rubricVersion: 1 }, unique: true },
  ]);
}

export async function listPublishedProblems(): Promise<ProblemDoc[]> {
  const db = await getDb();
  return problems(db).find({ status: "published" }).toArray();
}

export async function listAllProblems(): Promise<ProblemDoc[]> {
  const db = await getDb();
  return problems(db).find({}).sort({ _id: 1 }).toArray();
}

export async function listTracksFromDb(): Promise<TrackDoc[]> {
  const db = await getDb();
  return tracks(db).find({}).toArray();
}

export async function getProblem(id: string): Promise<ProblemDoc | null> {
  const db = await getDb();
  return problems(db).findOne({ _id: id });
}

export async function listRevisions(
  problemId: string,
): Promise<RubricRevisionDoc[]> {
  const db = await getDb();
  return revisions(db)
    .find({ problemId })
    .sort({ rubricVersion: -1 })
    .toArray();
}

export async function upsertDraft(input: UpsertDraftInput): Promise<ProblemDoc> {
  const rubric = parseRubric(input.rubric);
  const db = await getDb();
  const now = new Date();
  const existing = await problems(db).findOne({ _id: input._id });
  const status: ProblemStatus = input.status ?? existing?.status ?? "draft";
  const doc: ProblemDoc = {
    _id: input._id,
    pattern: input.pattern,
    difficulty: input.difficulty,
    coreAsk: input.coreAsk,
    title: input.title,
    topic: input.topic,
    status: status === "published" ? "draft" : status,
    rubricVersion: existing?.rubricVersion ?? 0,
    schemaVersion: 1,
    rubric: {
      ...rubric,
      problem_id: input._id,
    },
    publishedAt: existing?.publishedAt ?? null,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  await problems(db).replaceOne({ _id: input._id }, doc, { upsert: true });
  return doc;
}

export async function publishProblem(id: string): Promise<ProblemDoc> {
  const db = await getDb();
  const current = await problems(db).findOne({ _id: id });
  if (!current) throw new Error(`Problem not found: ${id}`);

  const nextVersion = (current.rubricVersion || 0) + 1;
  const rubric: Rubric = parseRubric({
    ...current.rubric,
    problem_id: id,
    rubric_version: nextVersion,
  });

  const publishedAt = new Date();
  const revision: RubricRevisionDoc = {
    _id: `${id}:v${nextVersion}`,
    problemId: id,
    rubricVersion: nextVersion,
    rubric,
    publishedAt,
  };

  try {
    await revisions(db).insertOne(revision);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: number }).code
        : undefined;
    if (code === 11000) {
      throw new Error(`Revision already exists for ${id} v${nextVersion}`);
    }
    throw err;
  }

  const updated: ProblemDoc = {
    ...current,
    status: "published",
    rubricVersion: nextVersion,
    rubric,
    publishedAt,
    updatedAt: publishedAt,
  };
  await problems(db).replaceOne({ _id: id }, updated);
  return updated;
}

export async function replaceTracks(trackList: ProblemTrack[]): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const docs: TrackDoc[] = trackList.map((track) => ({
    ...track,
    updatedAt: now,
  }));
  await tracks(db).deleteMany({});
  if (docs.length > 0) {
    await tracks(db).insertMany(docs);
  }
}
