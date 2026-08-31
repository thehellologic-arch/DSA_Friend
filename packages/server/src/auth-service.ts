import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { SkillLevel } from "@reason/core";
import type { Db } from "mongodb";
import { getDb } from "./mongo.js";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const MIN_PASSWORD_LEN = 6;
const BCRYPT_ROUNDS = 10;

export interface AuthUser {
  id: string;
  username: string;
  skillLevel: SkillLevel;
  onboarded: boolean;
  createdAt: string;
}

interface AuthUserDoc {
  _id: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  skillLevel: SkillLevel;
  onboarded: boolean;
  createdAt: Date;
  completedProblemIds: string[];
  topics: unknown[];
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateCredentials(username: string, password: string): void {
  if (!USERNAME_RE.test(username.trim())) {
    throw new AuthError(
      "Username must be 3–32 characters: letters, numbers, underscore",
      400,
    );
  }
  if (password.length < MIN_PASSWORD_LEN) {
    throw new AuthError("Password must be at least 6 characters", 400);
  }
}

function toAuthUser(doc: AuthUserDoc): AuthUser {
  return {
    id: doc._id,
    username: doc.username,
    skillLevel: doc.skillLevel,
    onboarded: doc.onboarded,
    createdAt: doc.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(private db: Db) {}

  private col() {
    return this.db.collection<AuthUserDoc>("users");
  }

  async ensureIndexes(): Promise<void> {
    await this.col().createIndexes([
      { key: { usernameNormalized: 1 }, unique: true },
    ]);
  }

  async register(username: string, password: string): Promise<AuthUser> {
    validateCredentials(username, password);
    const display = username.trim();
    const normalized = normalizeUsername(display);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const doc: AuthUserDoc = {
      _id: randomUUID(),
      username: display,
      usernameNormalized: normalized,
      passwordHash,
      skillLevel: "intermediate",
      onboarded: false,
      createdAt: new Date(),
      completedProblemIds: [],
      topics: [],
    };
    try {
      await this.col().insertOne(doc);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: number }).code
          : undefined;
      if (code === 11000) {
        throw new AuthError("Username is already taken", 409);
      }
      throw err;
    }
    return toAuthUser(doc);
  }

  async login(username: string, password: string): Promise<AuthUser> {
    if (!username.trim() || !password) {
      throw new AuthError("Username and password are required", 400);
    }
    const doc = await this.col().findOne({
      usernameNormalized: normalizeUsername(username),
    });
    if (!doc?.passwordHash) {
      throw new AuthError("Invalid username or password", 401);
    }
    const ok = await bcrypt.compare(password, doc.passwordHash);
    if (!ok) throw new AuthError("Invalid username or password", 401);
    return toAuthUser(doc);
  }

  async getById(id: string): Promise<AuthUser | null> {
    const doc = await this.col().findOne({ _id: id });
    if (!doc) return null;
    if (!doc.username || !doc.passwordHash) return null;
    return toAuthUser(doc);
  }
}

export async function createAuthService(): Promise<AuthService> {
  const db = await getDb();
  const service = new AuthService(db);
  await service.ensureIndexes();
  return service;
}
