import type {ShipfoxModule} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export {
  type CreateEmailChallengeParams,
  cleanupEmailChallenges,
  confirmEmailChallenge,
  consumeEmailChallengeProof,
  createEmailChallenge,
  type EmailChallengeHandle,
  resendEmailChallenge,
} from '#core/email-challenges.js';
export {EmailChallengeError, type EmailChallengeErrorCode} from '#core/errors.js';
export const emailChallengesModule: ShipfoxModule = {
  name: 'email-challenges',
  database: {db, migrationsPath},
};
