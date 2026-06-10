import {jwtVerify, SignJWT} from 'jose';

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface SignHs256Params {
  payload: Record<string, unknown>;
  secret: string;
  expiresIn: string;
  subject?: string;
  audience?: string;
}

export async function signHs256(params: SignHs256Params): Promise<string> {
  const jwt = new SignJWT(params.payload)
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(params.expiresIn);

  if (params.subject !== undefined) {
    jwt.setSubject(params.subject);
  }
  if (params.audience !== undefined) {
    jwt.setAudience(params.audience);
  }

  return await jwt.sign(encodeSecret(params.secret));
}

export interface VerifyHs256Params<T> {
  token: string;
  secret: string;
  // Structural so any Zod schema (or equivalent) satisfies it without coupling
  // this package to a validation library.
  schema: {parse(data: unknown): T};
  // When set, jose throws on an `aud` mismatch before the schema runs.
  audience?: string;
}

export async function verifyHs256<T>(params: VerifyHs256Params<T>): Promise<T> {
  const {payload} = await jwtVerify(params.token, encodeSecret(params.secret), {
    algorithms: ['HS256'],
    ...(params.audience !== undefined ? {audience: params.audience} : {}),
  });

  return params.schema.parse(payload);
}
