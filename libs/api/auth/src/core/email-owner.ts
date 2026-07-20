import {emailSchema} from '@shipfox/api-auth-dto';
import {findUserByEmail as findUserByEmailInDb} from '#db/users.js';
import type {User} from './entities/user.js';

export type EmailOwner = Pick<User, 'id' | 'email' | 'status'>;

export interface FindUserByEmailParams {
  email: string;
}

/**
 * Read-only lookup of the current owner of a normalized email. Performs no
 * user, session, or verification writes; returns undefined when no user owns
 * the address.
 */
export async function findUserByEmail(
  params: FindUserByEmailParams,
): Promise<EmailOwner | undefined> {
  const email = emailSchema.parse(params.email);
  const user = await findUserByEmailInDb({email});
  if (!user) return undefined;
  return {id: user.id, email: user.email, status: user.status};
}
