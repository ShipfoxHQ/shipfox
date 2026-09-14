import {findUserSummaryById, type UserSummary} from '#db/users.js';

export async function getUserSummary(params: {userId: string}): Promise<UserSummary | undefined> {
  return await findUserSummaryById({id: params.userId});
}
