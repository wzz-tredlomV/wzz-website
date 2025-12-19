import * as jose from 'https://cdn.skypack.dev/jose';

export async function utilsSign(payload, secret) {
  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
  return jwt;
}

