// The OAuth return URL for the web sign-in (`/auth/callback` on the origin
// the reader is actually on). RED: still the old fixed production base, so
// the preview-origin case fails — a preview reader's session lands on
// production and the preview tab stays signed out.
export const getWebAuthCallbackUrl = (_origin: string): string =>
  'https://web.readest.com/auth/callback';
