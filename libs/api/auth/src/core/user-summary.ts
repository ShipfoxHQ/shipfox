import {emailSchema} from '@shipfox/api-auth-dto';
import {findUserByEmail, findUserSummaryById, type UserSummary} from '#db/users.js';

export async function getUserSummary(params: {userId: string}): Promise<UserSummary | undefined> {
  return await findUserSummaryById({id: params.userId});
}

export async function getUserSummaryByEmail(params: {
  email: string;
}): Promise<UserSummary | undefined> {
  const user = await findUserByEmail({email: emailSchema.parse(params.email)});
  if (!user || user.status === 'deleted') return undefined;
  return {id: user.id, email: user.email, name: user.name};
}
