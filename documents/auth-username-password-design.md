# Auth (username + password)

Login required. No guest mode. No email/OAuth.

## Model

Mongo `users`:
- `_id` (uuid)
- `username` (display)
- `usernameNormalized` (lowercase, unique index)
- `passwordHash` (bcrypt)
- progress fields: `skillLevel`, `onboarded`, `topics`, `completedProblemIds`

## Session

httpOnly cookie `reason_uid` = user `_id`, set on register/login, cleared on logout.

## API

- `POST /api/auth/register` `{ username, password }`
- `POST /api/auth/login` `{ username, password }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Username: 3–32 chars, `[a-zA-Z0-9_]`, unique (case-insensitive).
Password: min 6 chars.
