import type { Rubric } from "@reason/core";
import type { ProblemTrack } from "./track-store.js";

export type ProblemStatus = "draft" | "published" | "archived";

export interface ProblemDoc {
  _id: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  title?: string;
  topic?: string;
  status: ProblemStatus;
  rubricVersion: number;
  schemaVersion: 1;
  rubric: Rubric;
  publishedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface RubricRevisionDoc {
  _id: string;
  problemId: string;
  rubricVersion: number;
  rubric: Rubric;
  publishedAt: Date;
}

export type TrackDoc = ProblemTrack & {
  updatedAt: Date;
};

export interface UpsertDraftInput {
  _id: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  title?: string;
  topic?: string;
  status?: ProblemStatus;
  rubric: Rubric;
}
