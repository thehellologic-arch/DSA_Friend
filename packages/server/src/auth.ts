import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthService, AuthUser } from "./auth-service.js";
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
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function clearUserCookie(reply: FastifyReply): void {
  reply.clearCookie(USER_COOKIE, { path: "/" });
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
  progress: ProgressService,
  patterns: string[],
): Promise<AuthUser> {
  const userId = readUserId(req);
  if (!userId) {
    reply.status(401).send({ error: "Login required" });
    throw new Error("LOGIN_REQUIRED");
  }
  const user = await auth.getById(userId);
  if (!user) {
    clearUserCookie(reply);
    reply.status(401).send({ error: "Login required" });
    throw new Error("LOGIN_REQUIRED");
  }
  await progress.ensureUser(user.id, user.skillLevel, patterns);
  return user;
}
