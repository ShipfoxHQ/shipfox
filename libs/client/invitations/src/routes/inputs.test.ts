import {validateInvitationAcceptSearch} from './inputs.js';

describe('invitation route inputs', () => {
  it('accepts a token and drops missing or malformed values', () => {
    expect(validateInvitationAcceptSearch({token: 'invite-token'})).toEqual({
      token: 'invite-token',
    });
    expect(validateInvitationAcceptSearch({})).toEqual({});
    expect(validateInvitationAcceptSearch({token: ['invite-token']})).toEqual({});
  });
});
