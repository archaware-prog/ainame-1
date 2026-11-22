export type AuthErrorAction = 'signin' | 'signup' | 'other';

function extractAuthErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = msg.match(/\b(auth\/[a-z0-9-]+)\b/i);
  return match ? match[1].toLowerCase() : '';
}

export function mapFirebaseAuthError(error: unknown, action: AuthErrorAction = 'other'): string {
  const code = extractAuthErrorCode(error);

  if (
    action === 'signin' &&
    (code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-credential')
  ) {
    return 'Email or password is incorrect';
  }

  if (action === 'signup' && code === 'auth/email-already-in-use') {
    return 'User already exists. Please sign in';
  }

  return 'Something went wrong. Please try again.';
}
