export interface InvitationAcceptSearch {
  token?: string;
}

export function validateInvitationAcceptSearch(
  input: Record<string, unknown>,
): InvitationAcceptSearch {
  const token = typeof input.token === 'string' && input.token.length > 0 ? input.token : undefined;
  return token ? {token} : {};
}
