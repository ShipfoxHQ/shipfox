import {EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS} from '@shipfox/api-auth-dto';
import {
  acceptWorkspaceInvitation,
  InvitationEmailMismatchError,
  listMembershipsByUser,
  peekInvitationByRawToken,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError as WorkspacesTokenInvalidError,
} from '@shipfox/api-workspaces';
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {config, mailer} from '#config.js';
import {
  consumeEmailVerification,
  createEmailVerification,
  createResendEmailVerification,
} from '#db/email-verifications.js';
import {consumePasswordReset, createPasswordReset} from '#db/password-resets.js';
import {
  createRefreshToken,
  findActiveRefreshTokenByHash,
  findRefreshTokenByHash,
  revokeRefreshTokenByHash,
  revokeRefreshTokensForUser,
  rotateRefreshToken,
} from '#db/refresh-tokens.js';
import {
  createUser as createDbUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  updateUserPassword,
} from '#db/users.js';
import type {RefreshToken} from './entities/refresh-token.js';
import type {User} from './entities/user.js';
import {
  AuthDependencyUnavailableError,
  EmailNotVerifiedError,
  EmailTakenError,
  InvalidCredentialsError,
  TokenInvalidError,
  UserNotFoundError,
} from './errors.js';
import {signUserToken} from './jwt.js';
import {hashPassword, verifyPassword} from './password.js';

const VERIFICATION_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;

let dummyHashCache: string | undefined;
async function getDummyHash(): Promise<string> {
  if (!dummyHashCache) {
    dummyHashCache = await hashPassword({password: 'dummy-for-timing-parity'});
  }
  return dummyHashCache;
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function signAccessToken(user: User): Promise<string> {
  const memberships = await listMembershipsByUser({userId: user.id}).catch((error: unknown) => {
    throw new AuthDependencyUnavailableError('workspaces', error);
  });
  return await signUserToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    memberships: memberships.map((m) => ({workspaceId: m.workspaceId, role: 'admin' as const})),
    secret: config.AUTH_JWT_SECRET,
    expiresIn: config.AUTH_JWT_EXPIRES_IN,
  });
}

function isWithinRotationGrace(refreshToken: RefreshToken): boolean {
  if (!refreshToken.rotatedAt) return false;
  const graceMs = config.AUTH_REFRESH_ROTATION_GRACE_SECONDS * 1000;
  return Date.now() - refreshToken.rotatedAt.getTime() <= graceMs;
}

async function createRefreshSession(user: User): Promise<string> {
  const refreshToken = generateOpaqueToken('refreshToken');
  await createRefreshToken({
    userId: user.id,
    hashedToken: hashOpaqueToken(refreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  return refreshToken;
}

async function sendVerificationEmail(user: User, rawToken: string): Promise<void> {
  const link = `${config.CLIENT_BASE_URL}/auth/verify-email?token=${rawToken}`;
  await mailer.send({
    to: user.email,
    subject: 'Verify your email',
    text: `Click to verify your email: ${link}`,
    html: `<p>Click to verify your email: <a href="${link}">${link}</a></p>`,
  });
}

async function createAndSendEmailVerification(user: User): Promise<void> {
  const rawToken = generateOpaqueToken('emailVerification');
  await createEmailVerification({
    userId: user.id,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: hoursFromNow(VERIFICATION_TTL_HOURS),
  });

  await sendVerificationEmail(user, rawToken);
}

export interface SignupParams {
  email: string;
  password: string;
  name?: string | undefined;
}

export async function signup(params: SignupParams): Promise<User> {
  const existing = await findUserByEmail({email: params.email});
  if (existing) {
    throw new EmailTakenError(params.email);
  }

  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email: params.email,
    hashedPassword,
    name: params.name ?? null,
  });

  await createAndSendEmailVerification(user);

  return user;
}

export interface SignupWithInvitationParams extends SignupParams {
  invitationToken: string;
}

export interface SignupWithInvitationResult extends LoginResult {
  membership: {id: string; userId: string; workspaceId: string} | null;
  acceptError?: {code: string; message: string};
}

export async function signupWithInvitation(
  params: SignupWithInvitationParams,
): Promise<SignupWithInvitationResult> {
  // Step 1: Pre-validate the invitation BEFORE any user write so an invalid
  // token never produces an orphan user. Re-validation happens again inside
  // acceptWorkspaceInvitation (race-safe) after the user is created.
  const invitation = await peekInvitationByRawToken({token: params.invitationToken});
  if (!invitation) {
    throw new WorkspacesTokenInvalidError('Invitation token is invalid');
  }
  if (invitation.acceptedAt !== null) {
    throw new TokenAlreadyUsedError();
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new TokenExpiredError();
  }
  if (invitation.email !== params.email) {
    throw new InvitationEmailMismatchError();
  }

  // Step 2: Create the user as verified. The invitation email is the proof of
  // ownership, and this avoids a second auth-table write just to mark verified.
  const existing = await findUserByEmail({email: params.email});
  if (existing) {
    throw new EmailTakenError(params.email);
  }
  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email: params.email,
    hashedPassword,
    name: params.name ?? null,
    emailVerifiedAt: new Date(),
  });

  // Step 3: Accept the invitation through the workspaces module boundary.
  // This is intentionally not one database transaction with auth; treat it like
  // calling another service. If it fails after user creation, return a verified
  // signed-in user and an explicit retryable accept error.
  let membership: SignupWithInvitationResult['membership'] = null;
  let acceptError: SignupWithInvitationResult['acceptError'];
  try {
    const result = await acceptWorkspaceInvitation({
      token: params.invitationToken,
      userId: user.id,
      email: user.email,
      name: user.name,
    });
    membership = {
      id: result.membership.id,
      userId: result.membership.userId,
      workspaceId: result.membership.workspaceId,
    };
  } catch (error) {
    if (
      error instanceof WorkspacesTokenInvalidError ||
      error instanceof TokenAlreadyUsedError ||
      error instanceof TokenExpiredError ||
      error instanceof InvitationEmailMismatchError
    ) {
      acceptError = {code: error.name, message: error.message};
    } else {
      acceptError = {
        code: 'AcceptFailed',
        message: 'Could not accept the invitation; please retry from the invite link.',
      };
    }
  }

  // Step 4: Issue session. signAccessToken reads memberships through the
  // workspaces module API, so a successful accept is reflected in the JWT.
  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  if (acceptError) {
    return {token, refreshToken, user, membership, acceptError};
  }
  return {token, refreshToken, user, membership};
}

export interface CreateUserParams extends SignupParams {
  verified: boolean;
}

export async function createUser(params: CreateUserParams): Promise<User> {
  const existing = await findUserByEmail({email: params.email});
  if (existing) {
    throw new EmailTakenError(params.email);
  }

  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email: params.email,
    hashedPassword,
    name: params.name ?? null,
    emailVerifiedAt: params.verified ? new Date() : null,
  });

  return user;
}

export interface LoginParams {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  user: User;
}

export async function login(params: LoginParams): Promise<LoginResult> {
  const user = await findUserByEmail({email: params.email});

  if (!user) {
    await verifyPassword({password: params.password, hash: await getDummyHash()});
    throw new InvalidCredentialsError();
  }

  const ok = await verifyPassword({password: params.password, hash: user.hashedPassword});
  if (!ok || user.status !== 'active') {
    throw new InvalidCredentialsError();
  }

  if (user.emailVerifiedAt === null) {
    throw new EmailNotVerifiedError();
  }

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export interface CreateSessionForUserParams {
  userId?: string | undefined;
  email?: string | undefined;
}

export async function createSessionForUser(
  params: CreateSessionForUserParams,
): Promise<LoginResult> {
  const user = params.userId
    ? await findUserById({id: params.userId})
    : params.email
      ? await findUserByEmail({email: params.email})
      : undefined;

  if (!user) {
    throw new UserNotFoundError(params.userId ?? params.email ?? 'unknown');
  }
  if (user.emailVerifiedAt === null) {
    throw new EmailNotVerifiedError();
  }
  if (user.status !== 'active') {
    throw new InvalidCredentialsError();
  }

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export interface RefreshAccessTokenResult {
  token: string;
  /** Undefined on a grace-window hit: keep the existing cookie instead of rotating it. */
  refreshToken: string | undefined;
  user: User;
}

export async function refreshAccessToken(params: {
  refreshToken: string;
}): Promise<RefreshAccessTokenResult> {
  const currentHashedToken = hashOpaqueToken(params.refreshToken);
  const current = await findRefreshTokenByHash({hashedToken: currentHashedToken});
  if (!current) {
    throw new TokenInvalidError('Refresh token is invalid or expired');
  }

  const user = await findUserById({id: current.userId});
  if (user?.status !== 'active') {
    await revokeRefreshTokenByHash({hashedToken: currentHashedToken});
    throw new TokenInvalidError('Refresh token is invalid or expired');
  }

  // Within the grace window a rotated token means a concurrent refresh (e.g. a
  // second tab); past it, reuse of a retired token means a compromised session.
  if (current.rotatedAt) {
    if (isWithinRotationGrace(current)) {
      const token = await signAccessToken(user);
      return {token, refreshToken: undefined, user};
    }
    await revokeRefreshTokensForUser({userId: user.id});
    throw new TokenInvalidError('Refresh token reused after rotation');
  }

  // Losing the CAS requires a state check: another request may have rotated,
  // revoked, or expired the token before this refresh could claim it.
  const nextRefreshToken = generateOpaqueToken('refreshToken');
  const rotated = await rotateRefreshToken({
    id: current.id,
    currentHashedToken,
    nextHashedToken: hashOpaqueToken(nextRefreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  if (!rotated) {
    const latest = await findRefreshTokenByHash({hashedToken: currentHashedToken});
    if (!latest || !isWithinRotationGrace(latest)) {
      throw new TokenInvalidError('Refresh token is invalid or expired');
    }
    const token = await signAccessToken(user);
    return {token, refreshToken: undefined, user};
  }

  const token = await signAccessToken(user);
  return {token, refreshToken: nextRefreshToken, user};
}

export interface ConfirmEmailVerificationResult {
  token: string;
  refreshToken: string;
  user: User;
}

export interface ResendEmailVerificationResult {
  nextResendAvailableAt: Date;
}

export async function confirmEmailVerification(params: {
  token: string;
}): Promise<ConfirmEmailVerificationResult> {
  const consumed = await consumeEmailVerification({hashedToken: hashOpaqueToken(params.token)});
  if (!consumed) {
    throw new TokenInvalidError('Verification token is invalid or expired');
  }

  const user = await markEmailVerified({userId: consumed.userId});
  if (user?.status !== 'active') {
    throw new TokenInvalidError('Verification token is invalid or expired');
  }

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export async function resendEmailVerification(params: {
  email: string;
}): Promise<ResendEmailVerificationResult> {
  const rawToken = generateOpaqueToken('emailVerification');
  const result = await createResendEmailVerification({
    email: params.email,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: hoursFromNow(VERIFICATION_TTL_HOURS),
    cooldownSeconds: EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
  });

  if (result.user && result.verification) {
    await sendVerificationEmail(result.user, rawToken);
  }

  return {nextResendAvailableAt: result.nextResendAvailableAt};
}

export async function requestPasswordReset(params: {email: string}): Promise<void> {
  const user = await findUserByEmail({email: params.email});
  if (user?.status !== 'active') {
    return;
  }

  const rawToken = generateOpaqueToken('passwordReset');
  await createPasswordReset({
    userId: user.id,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: hoursFromNow(RESET_TTL_HOURS),
  });

  const link = `${config.CLIENT_BASE_URL}/auth/reset?token=${rawToken}`;
  await mailer.send({
    to: user.email,
    subject: 'Reset your password',
    text: `Click to reset your password: ${link}`,
    html: `<p>Click to reset your password: <a href="${link}">${link}</a></p>`,
  });
}

export interface ConfirmPasswordResetResult {
  token: string;
  refreshToken: string;
  user: User;
}

export async function confirmPasswordReset(params: {
  token: string;
  newPassword: string;
}): Promise<ConfirmPasswordResetResult> {
  const consumed = await consumePasswordReset({hashedToken: hashOpaqueToken(params.token)});
  if (!consumed) {
    throw new TokenInvalidError('Reset token is invalid or expired');
  }

  const hashedPassword = await hashPassword({password: params.newPassword});
  const user = await updateUserPassword({userId: consumed.userId, hashedPassword});
  if (user?.status !== 'active') {
    throw new TokenInvalidError('Reset token is invalid or expired');
  }

  await revokeRefreshTokensForUser({userId: consumed.userId});

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  refreshToken?: string | undefined;
}): Promise<void> {
  const user = await findUserById({id: params.userId});
  if (!user) {
    throw new UserNotFoundError(params.userId);
  }

  const ok = await verifyPassword({
    password: params.currentPassword,
    hash: user.hashedPassword,
  });
  if (!ok) {
    throw new InvalidCredentialsError();
  }

  const hashedPassword = await hashPassword({password: params.newPassword});
  const currentRefreshSession = params.refreshToken
    ? await findActiveRefreshTokenByHash({hashedToken: hashOpaqueToken(params.refreshToken)})
    : undefined;
  const exceptRefreshTokenId =
    currentRefreshSession?.userId === user.id ? currentRefreshSession.id : undefined;

  await updateUserPassword({userId: user.id, hashedPassword});
  await revokeRefreshTokensForUser({userId: user.id, exceptRefreshTokenId});
}

export async function logout(params: {refreshToken?: string | undefined}): Promise<void> {
  if (!params.refreshToken) return;
  await revokeRefreshTokenByHash({hashedToken: hashOpaqueToken(params.refreshToken)});
}

export interface GetCurrentUserResult {
  user: User;
}

export async function getCurrentUser(params: {userId: string}): Promise<GetCurrentUserResult> {
  const user = await findUserById({id: params.userId});
  if (!user) {
    throw new UserNotFoundError(params.userId);
  }

  return {user};
}
