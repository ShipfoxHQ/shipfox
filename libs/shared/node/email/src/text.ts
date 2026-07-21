export type TemplateName =
  | 'verification-code'
  | 'verify-email'
  | 'reset-password'
  | 'workspace-invitation';

export interface VerificationCodeData {
  verificationCode: string;
  expiresInMinutes: number;
}

export interface VerifyEmailData {
  verifyLink: string;
}

export interface ResetPasswordData {
  resetLink: string;
  expiresInHours: number;
}

export interface WorkspaceInvitationData {
  email: string;
  workspaceName: string;
  inviterName: string;
  inviteLink: string;
}

export interface TemplateVariables {
  'verification-code': VerificationCodeData;
  'verify-email': VerifyEmailData;
  'reset-password': ResetPasswordData;
  'workspace-invitation': WorkspaceInvitationData;
}

const signature = 'Thanks,\nThe Shipfox team';

const builders: {[Name in TemplateName]: (data: TemplateVariables[Name]) => string} = {
  'verification-code': ({verificationCode, expiresInMinutes}) =>
    [
      'Your Shipfox verification code',
      '',
      "You're almost there. Enter this code to verify your email and finish setting up your Shipfox account:",
      '',
      verificationCode,
      '',
      `This code expires in ${expiresInMinutes} minutes. If you didn't request it, you can safely ignore this email.`,
      '',
      signature,
    ].join('\n'),

  'verify-email': ({verifyLink}) =>
    [
      'Verify your email',
      '',
      'Welcome to Shipfox! Confirm this email address to finish setting up your account.',
      '',
      'Verify your email:',
      verifyLink,
      '',
      "If you didn't create a Shipfox account, you can safely ignore this email.",
      '',
      signature,
    ].join('\n'),

  'reset-password': ({resetLink, expiresInHours}) =>
    [
      'Reset your password',
      '',
      'We received a request to reset the password for your Shipfox account.',
      '',
      'Reset your password:',
      resetLink,
      '',
      `This link expires in ${expiresInHours}h. If you didn't request a password reset, you can safely ignore this email.`,
      '',
      signature,
    ].join('\n'),

  'workspace-invitation': ({email, workspaceName, inviterName, inviteLink}) =>
    [
      `You're invited to join ${workspaceName}`,
      '',
      `${inviterName} has invited you to join the ${workspaceName} workspace on Shipfox.`,
      '',
      'Accept the invitation:',
      inviteLink,
      '',
      `This invitation was sent to ${email}. If you weren't expecting it, you can safely ignore this email.`,
      '',
      signature,
    ].join('\n'),
};

export function renderText<Name extends TemplateName>(
  name: Name,
  data: TemplateVariables[Name],
): string {
  return builders[name](data);
}
