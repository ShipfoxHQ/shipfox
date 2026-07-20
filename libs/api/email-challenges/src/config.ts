import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  EMAIL_CHALLENGE_ROOT_KEY: str({
    desc: 'Secret used to derive separate keyed hashes for email codes, continuations, and destination limits. Required; generate a unique random value for each environment.',
  }),
  EMAIL_CHALLENGE_DESTINATION_HOURLY_LIMIT: num({
    desc: 'Maximum email-challenge messages sent to one normalized destination in a rolling hour.',
    default: 5,
  }),
  EMAIL_CHALLENGE_DESTINATION_DAILY_LIMIT: num({
    desc: 'Maximum email-challenge messages sent to one normalized destination in a rolling day.',
    default: 15,
  }),
  EMAIL_CHALLENGE_SOURCE_IP_HOURLY_LIMIT: num({
    desc: 'Maximum email-challenge messages sent from one source IP address in a rolling hour.',
    default: 20,
  }),
});
