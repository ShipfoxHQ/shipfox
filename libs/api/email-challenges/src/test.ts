import {initializeModules} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {challenges} from '#db/schema/challenges.js';
import {sendLimits} from '#db/schema/send-limits.js';
import {emailChallengesModule} from './index.js';

/** Initialize the owner-declared Email Challenges storage for database-backed tests. */
export async function initializeEmailChallengesForTests(): Promise<void> {
  await initializeModules({modules: [emailChallengesModule]});
}

/** Reset Email Challenges storage without exposing its tables to consumers. */
export async function resetEmailChallengesForTests(): Promise<void> {
  await db().delete(challenges);
  await db().delete(sendLimits);
}
