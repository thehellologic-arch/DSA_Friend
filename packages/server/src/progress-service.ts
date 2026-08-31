import {
  applyRatingUpdate,
  computeMasteryPercent,
  deriveTopicStatus,
  levelAvailability,
  levelBandLabel,
  ratingToLevel,
  recommendProblems,
  STARTING_RATING,
  type RecommendableProblem,
  type SkillLevel,
  type TopicProgress,
  type Verdict,
} from "@reason/core";
import { randomUUID } from "node:crypto";
import type {
  ProgressRepository,
  StoredAttempt,
  TopicProgressRow,
  UserRecord,
} from "./progress-repository.js";
import { listTracks } from "./track-store.js";

export interface RecordVerdictInput {
  userId: string;
  sessionId: string;
  problemSlug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  selfCorrections: number;
  transcript: { role: "USER" | "AI"; content: string }[];
  verdict: Verdict;
}

export interface ProgressUpdate {
  pattern: string;
  ratingBefore: number;
  ratingAfter: number;
  masteryBefore: number;
  masteryAfter: number;
  newlyMasteredInsights: Verdict["insights"];
  recommendedNext: RecommendableProblem | null;
  ratingEligible: boolean;
  ratingDelta: number;
  validationStatus: Verdict["label"];
  validationEvidence: string[];
}

function validationEvidenceFrom(verdict: Verdict): string[] {
  const evidence: string[] = [];
  const suggestion = verdict.suggestion.trim();
  if (suggestion) evidence.push(suggestion);
  return evidence;
}

function isRatingEligible(label: Verdict["label"]): boolean {
  return label !== "plausible_unverified";
}

export interface UserProgress {
  userId: string;
  skillLevel: SkillLevel;
  onboarded: boolean;
  topics: TopicProgress[];
}

export interface RoadmapLevel {
  level: number;
  bandLabel: string;
  availability: ReturnType<typeof levelAvailability>;
  problems: RecommendableProblem[];
}

export interface RoadmapTopic extends TopicProgress {
  recommendedLevel: number;
  levels: RoadmapLevel[];
}

export interface RoadmapTrackProblem extends RecommendableProblem {
  title: string;
  completed: boolean;
}

export interface RoadmapTrackGroup {
  id: string;
  title: string;
  completedCount: number;
  problemCount: number;
  problems: RoadmapTrackProblem[];
}

export interface RoadmapTrack {
  id: string;
  title: string;
  groups: RoadmapTrackGroup[];
}

export interface Roadmap {
  skillLevel: SkillLevel;
  tracks: RoadmapTrack[];
  topics: RoadmapTopic[];
}

export class ProgressService {
  constructor(
    private repo: ProgressRepository,
    private listProblems: () => RecommendableProblem[],
    private now: () => Date = () => new Date(),
  ) {}

  async ensureUser(
    id: string,
    skillLevel: SkillLevel,
    patterns: string[],
  ): Promise<UserRecord> {
    const existing = await this.repo.getUser(id);
    if (existing) {
      await this.ensureTopics(id, existing.skillLevel, patterns);
      return existing;
    }
    const user = await this.repo.createUser(id, skillLevel, false);
    await this.ensureTopics(id, skillLevel, patterns);
    return user;
  }

  async setSkillLevel(
    userId: string,
    skillLevel: SkillLevel,
    patterns: string[],
    onboarded = true,
  ): Promise<UserRecord> {
    let user = await this.repo.getUser(userId);
    if (!user) {
      user = await this.repo.createUser(userId, skillLevel, onboarded);
    } else {
      user = await this.repo.setSkillLevel(userId, skillLevel);
    }
    if (onboarded && !user.onboarded) {
      user = await this.repo.markOnboarded(userId);
    }

    const rows = await this.repo.listTopicProgress(userId);
    for (const pattern of patterns) {
      const row = rows.find((item) => item.pattern === pattern);
      if (!row || row.problemsCompleted === 0) {
        await this.repo.upsertTopicProgress({
          userId,
          pattern,
          rating: STARTING_RATING[skillLevel],
          masteryPercent: 0,
          problemsCompleted: 0,
          hintUsage: 0,
          lastPracticedAt: null,
          recentPerformance: [],
        });
      }
    }
    return user;
  }

  async recordVerdict(input: RecordVerdictInput): Promise<ProgressUpdate> {
    const existing = await this.repo.getAttemptBySessionId(input.sessionId);
    if (existing) {
      return {
        pattern: existing.pattern,
        ratingBefore: existing.ratingBefore,
        ratingAfter: existing.ratingAfter,
        masteryBefore: existing.masteryBefore,
        masteryAfter: existing.masteryAfter,
        newlyMasteredInsights: existing.newlyMasteredInsights,
        recommendedNext: await this.recommendNext(
          input.userId,
          existing.problemSlug,
        ),
        ratingEligible: isRatingEligible(existing.verdictLabel),
        ratingDelta: existing.ratingAfter - existing.ratingBefore,
        validationStatus: existing.verdictLabel,
        validationEvidence: validationEvidenceFrom(existing.verdict),
      };
    }

    const current = await this.requireTopic(input.userId, input.pattern);
    const ratingEligible = isRatingEligible(input.verdict.label);
    const evidence = validationEvidenceFrom(input.verdict);

    if (!ratingEligible) {
      const attemptId = randomUUID();
      await this.repo.insertAttempt({
        id: attemptId,
        userId: input.userId,
        sessionId: input.sessionId,
        problemSlug: input.problemSlug,
        pattern: input.pattern,
        difficulty: input.difficulty,
        coreAsk: input.coreAsk,
        score: input.verdict.score,
        verdictLabel: input.verdict.label,
        hintsUsed: input.verdict.hintsUsed,
        selfCorrections: input.selfCorrections,
        insightResults: input.verdict.insights,
        ratingBefore: current.rating,
        ratingAfter: current.rating,
        masteryBefore: current.masteryPercent,
        masteryAfter: current.masteryPercent,
        newlyMasteredInsights: [],
        transcript: input.transcript,
        verdict: input.verdict,
      });

      return {
        pattern: input.pattern,
        ratingBefore: current.rating,
        ratingAfter: current.rating,
        masteryBefore: current.masteryPercent,
        masteryAfter: current.masteryPercent,
        newlyMasteredInsights: [],
        recommendedNext: await this.recommendNext(
          input.userId,
          input.problemSlug,
        ),
        ratingEligible: false,
        ratingDelta: 0,
        validationStatus: input.verdict.label,
        validationEvidence: evidence,
      };
    }

    const rating = applyRatingUpdate({
      rating: current.rating,
      difficulty: input.difficulty,
      score: input.verdict.score,
      hintsUsed: input.verdict.hintsUsed,
    });
    const recentPerformance = [
      input.verdict.score,
      ...current.recentPerformance,
    ].slice(0, 5);
    const masteryAfter = computeMasteryPercent(recentPerformance);
    const history = await this.repo.listAttempts(input.userId);
    const previousYes = new Set<string>();
    for (const attempt of history.filter((item) => item.pattern === input.pattern)) {
      for (const insight of attempt.insightResults) {
        if (insight.status === "yes") previousYes.add(insight.id);
      }
    }
    const newlyMasteredInsights = input.verdict.insights.filter(
      (insight) => insight.status === "yes" && !previousYes.has(insight.id),
    );

    const attemptId = randomUUID();
    await this.repo.insertAttempt({
      id: attemptId,
      userId: input.userId,
      sessionId: input.sessionId,
      problemSlug: input.problemSlug,
      pattern: input.pattern,
      difficulty: input.difficulty,
      coreAsk: input.coreAsk,
      score: input.verdict.score,
      verdictLabel: input.verdict.label,
      hintsUsed: input.verdict.hintsUsed,
      selfCorrections: input.selfCorrections,
      insightResults: input.verdict.insights,
      ratingBefore: rating.ratingBefore,
      ratingAfter: rating.ratingAfter,
      masteryBefore: current.masteryPercent,
      masteryAfter,
      newlyMasteredInsights,
      transcript: input.transcript,
      verdict: input.verdict,
    });
    await this.repo.insertRatingEvent({
      id: randomUUID(),
      userId: input.userId,
      attemptId,
      pattern: input.pattern,
      ratingBefore: rating.ratingBefore,
      ratingAfter: rating.ratingAfter,
      delta: rating.delta,
    });
    await this.repo.upsertTopicProgress({
      ...current,
      rating: rating.ratingAfter,
      masteryPercent: masteryAfter,
      problemsCompleted: current.problemsCompleted + 1,
      hintUsage: current.hintUsage + input.verdict.hintsUsed,
      lastPracticedAt: this.now().toISOString(),
      recentPerformance,
    });

    return {
      pattern: input.pattern,
      ratingBefore: rating.ratingBefore,
      ratingAfter: rating.ratingAfter,
      masteryBefore: current.masteryPercent,
      masteryAfter,
      newlyMasteredInsights,
      recommendedNext: await this.recommendNext(input.userId, input.problemSlug),
      ratingEligible: true,
      ratingDelta: rating.delta,
      validationStatus: input.verdict.label,
      validationEvidence: evidence,
    };
  }

  async getProgress(userId: string): Promise<UserProgress> {
    const user = await this.repo.getUser(userId);
    if (!user) throw new Error("User not found");
    const rows = await this.repo.listTopicProgress(userId);
    const recommendedPattern = this.pickRecommendedPattern(rows);
    return {
      userId,
      skillLevel: user.skillLevel,
      onboarded: user.onboarded,
      topics: rows.map((row) => this.toTopicProgress(row, recommendedPattern)),
    };
  }

  async listAttempts(userId: string): Promise<StoredAttempt[]> {
    return this.repo.listAttempts(userId);
  }

  async getRoadmap(userId: string): Promise<Roadmap> {
    const progress = await this.getProgress(userId);
    const problems = this.listProblems();
    const bySlug = new Map(problems.map((problem) => [problem.slug, problem]));
    const completed = new Set(
      (await this.repo.listAttempts(userId)).map((attempt) => attempt.problemSlug),
    );
    const topics = progress.topics.map((topic) => {
      const recommendedLevel = ratingToLevel(topic.rating);
      const levels = [1, 2, 3, 4, 5].map((level) => ({
        level,
        bandLabel: levelBandLabel(level),
        availability: levelAvailability({
          level,
          recommendedLevel,
          masteryPercent: topic.masteryPercent,
        }),
        problems: problems.filter(
          (problem) =>
            problem.pattern === topic.pattern &&
            ratingToLevel(problem.difficulty) === level,
        ),
      }));
      return { ...topic, recommendedLevel, levels };
    });
    const tracks = listTracks().map((track) => ({
      id: track.id,
      title: track.title,
      groups: track.groups.map((group) => {
        const groupProblems = group.problems.flatMap((entry) => {
          const problem = bySlug.get(entry.slug);
          if (!problem) return [];
          return [
            {
              ...problem,
              title: entry.title,
              completed: completed.has(entry.slug),
            },
          ];
        });
        return {
          id: group.id,
          title: group.title,
          completedCount: groupProblems.filter((problem) => problem.completed)
            .length,
          problemCount: groupProblems.length,
          problems: groupProblems,
        };
      }),
    }));
    return { skillLevel: progress.skillLevel, tracks, topics };
  }

  async recommendNext(
    userId: string,
    excludeSlug?: string,
    filters?: { pattern?: string; difficulty?: number },
  ): Promise<RecommendableProblem | null> {
    const ranked = await this.recommend(userId, 5, excludeSlug, filters);
    return ranked[0] ?? null;
  }

  async recommend(
    userId: string,
    limit = 5,
    excludeSlug?: string,
    filters?: { pattern?: string; difficulty?: number },
  ): Promise<RecommendableProblem[]> {
    const progress = await this.getProgress(userId);
    const attempts = await this.repo.listAttempts(userId);
    return recommendProblems(
      this.listProblems(),
      {
        topics: progress.topics,
        recentAttempts: attempts.map((attempt) => ({
          problemSlug: attempt.problemSlug,
          pattern: attempt.pattern,
          score: attempt.score,
        })),
        preferredPattern: filters?.pattern,
        preferredDifficulty: filters?.difficulty,
        excludeSlug,
        now: this.now(),
      },
      limit,
    );
  }

  private pickRecommendedPattern(rows: TopicProgressRow[]): string | null {
    if (rows.length === 0) return null;
    return (
      [...rows].sort((a, b) => {
        if (a.problemsCompleted === 0 && b.problemsCompleted > 0) return 1;
        if (b.problemsCompleted === 0 && a.problemsCompleted > 0) return -1;
        return a.rating - b.rating || a.masteryPercent - b.masteryPercent;
      })[0]?.pattern ?? null
    );
  }

  private toTopicProgress(
    row: TopicProgressRow,
    recommendedPattern: string | null,
  ): TopicProgress {
    return {
      pattern: row.pattern,
      rating: row.rating,
      masteryPercent: row.masteryPercent,
      problemsCompleted: row.problemsCompleted,
      recentPerformance: row.recentPerformance,
      hintUsage: row.hintUsage,
      lastPracticedAt: row.lastPracticedAt,
      status: deriveTopicStatus({
        problemsCompleted: row.problemsCompleted,
        masteryPercent: row.masteryPercent,
        lastPracticedAt: row.lastPracticedAt,
        now: this.now(),
        isRecommendedTopic: row.pattern === recommendedPattern,
      }),
    };
  }

  private async ensureTopics(
    userId: string,
    skillLevel: SkillLevel,
    patterns: string[],
  ) {
    for (const pattern of patterns) {
      const existing = await this.repo.getTopicProgress(userId, pattern);
      if (existing) continue;
      await this.repo.upsertTopicProgress({
        userId,
        pattern,
        rating: STARTING_RATING[skillLevel],
        masteryPercent: 0,
        problemsCompleted: 0,
        hintUsage: 0,
        lastPracticedAt: null,
        recentPerformance: [],
      });
    }
  }

  private async requireTopic(
    userId: string,
    pattern: string,
  ): Promise<TopicProgressRow> {
    const existing = await this.repo.getTopicProgress(userId, pattern);
    if (existing) return existing;
    const user = await this.repo.getUser(userId);
    const rating = STARTING_RATING[user?.skillLevel ?? "intermediate"];
    return this.repo.upsertTopicProgress({
      userId,
      pattern,
      rating,
      masteryPercent: 0,
      problemsCompleted: 0,
      hintUsage: 0,
      lastPracticedAt: null,
      recentPerformance: [],
    });
  }
}
