// The OAuth return URL for the web sign-in (`/auth/callback` on the origin
// the reader is actually on). A fixed production base strands preview
// deployments: the session lands on production and the preview tab stays
// signed out (no token, no Edge proxy, Premium badge stuck on).
export const getWebAuthCallbackUrl = (origin: string): string => `${origin}/auth/callback`;
