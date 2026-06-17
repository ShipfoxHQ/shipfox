import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  ANTHROPIC_API_KEY: str({
    desc: 'Anthropic API key the agent step gives to the pi harness. Set it to run agent steps against Anthropic models. When empty, agent steps fail at invocation instead of crashing the runner. The pi harness also reads this variable from the process environment.',
    default: '',
  }),
});
