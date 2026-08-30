import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SkillLevel } from "@reason/core";
import type { ProgressService } from "./progress-service.js";

export const USER_COOKIE = "reason_uid";

export function readUserId(req: FastifyRequest): string | undefined {
  return req.cookies?.[USER_COOKIE];
}

export function writeUserCookie(reply: FastifyReply, userId: string): void {
  reply.setCookie(USER_COOKIE, userId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function ensureGuest(
  req: FastifyRequest,
  reply: FastifyReply,
  progress: ProgressService,
  patterns: string[],
  skillLevel: SkillLevel = "intermediate",
): Promise<string> {
  const existing = readUserId(req);
  const userId = existing ?? randomUUID();
  await progress.ensureUser(userId, skillLevel, patterns);
  if (!existing) writeUserCookie(reply, userId);
  return userId;
}
