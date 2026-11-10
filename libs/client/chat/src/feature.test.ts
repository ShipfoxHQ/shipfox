import {agentFlags} from '@shipfox/api-agent-dto';
import {chatFeature} from './feature.js';

describe('chatFeature', () => {
  it.each([true, false])('offers the dock while agent-chat is %s', (enabled) => {
    const useFlag = vi.fn(() => enabled);

    const available = chatFeature.projectDock.useAvailable({useFlag});

    expect(available).toBe(enabled);
    expect(useFlag).toHaveBeenCalledWith(agentFlags['agent-chat']);
  });
});
