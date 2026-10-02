import {buildMessageCreate} from './discord-gateway.js';

describe('Discord message dispatch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const params = {
    connectionId: 'connection-1',
    channelId: '200',
    messageId: '300',
    content: 'hello',
    authorId: 'user-1',
  };

  it('mentions the bot user by default', () => {
    vi.stubEnv('DISCORD_APPLICATION_ID', 'application-1');

    expect(buildMessageCreate(params)).toMatchObject({
      id: '300',
      channel_id: '200',
      mentions: [{id: 'application-1'}],
    });
  });

  it('leaves out the mention when the message does not have one', () => {
    expect(buildMessageCreate({...params, mentionsBot: false}).mentions).toEqual([]);
  });
});
