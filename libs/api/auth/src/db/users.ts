import {eq} from 'drizzle-orm';
import type {User} from '#core/entities/user.js';
import {EmailTakenError} from '#core/errors.js';
import {db} from './db.js';
import {toUser, type UserDb, users} from './schema/users.js';

export interface CreateUserParams {
  email: string;
  hashedPassword: string | null;
  name?: string | null;
  emailVerifiedAt?: Date | null;
}

export interface ProvisionUserParams {
  email: string;
  name?: string | null;
}

// Drizzle wraps the underlying Postgres error; walk `.cause` to reach it.
function isAuthUsersEmailUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current !== 'object') return false;
    const {code, constraint} = current as {code?: unknown; constraint?: unknown};
    if (code === '23505' && constraint === 'auth_users_email_unique') return true;
    current = (current as {cause?: unknown}).cause;
  }
  return false;
}

export async function createUser(params: CreateUserParams): Promise<User> {
  let rows: UserDb[];
  try {
    rows = await db()
      .insert(users)
      .values({
        email: params.email,
        hashedPassword: params.hashedPassword,
        name: params.name ?? null,
        emailVerifiedAt: params.emailVerifiedAt ?? null,
      })
      .returning();
  } catch (error) {
    if (isAuthUsersEmailUniqueViolation(error)) {
      throw new EmailTakenError(params.email);
    }
    throw error;
  }

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toUser(row);
}

export async function provisionUser(params: ProvisionUserParams): Promise<User> {
  const rows = await db()
    .insert(users)
    .values({
      email: params.email,
      hashedPassword: null,
      name: params.name ?? null,
      emailVerifiedAt: new Date(),
    })
    .onConflictDoNothing({target: users.email})
    .returning();

  const row = rows[0];
  if (row) return toUser(row);

  const existing = await findUserByEmail({email: params.email});
  if (existing) return existing;
  throw new Error('Provisioning user conflict returned no user');
}

export async function findUserByEmail(params: {email: string}): Promise<User | undefined> {
  const rows = await db().select().from(users).where(eq(users.email, params.email)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}

export async function findUserById(params: {id: string}): Promise<User | undefined> {
  const rows = await db().select().from(users).where(eq(users.id, params.id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}

export interface UpdateUserPasswordParams {
  userId: string;
  hashedPassword: string;
}

export async function updateUserPassword(
  params: UpdateUserPasswordParams,
): Promise<User | undefined> {
  const rows = await db()
    .update(users)
    .set({
      hashedPassword: params.hashedPassword,
      updatedAt: new Date(),
    })
    .where(eq(users.id, params.userId))
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}

export async function markEmailVerified(params: {userId: string}): Promise<User | undefined> {
  const rows = await db()
    .update(users)
    .set({emailVerifiedAt: new Date(), updatedAt: new Date()})
    .where(eq(users.id, params.userId))
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}
