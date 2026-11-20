import { describe, expect, it } from 'vitest';
import { getWebAuthCallbackUrl } from '@/utils/authRedirect';

// The web sign-in must return to the origin the reader is actually on.
// Production builds used to return a fixed production callback, so a reader
// on a Vercel preview signed in on production instead: the preview tab kept
// no token, Edge TTS kept asking to log in, and the Premium badge stayed.
describe('getWebAuthCallbackUrl', () => {
  it('returns the callback on the preview origin, not production', () => {
    expect(
      getWebAuthCallbackUrl(
        'https://our-reader-git-edge-tts-background-audio-xm-an-towfiqul.vercel.app',
      ),
    ).toBe(
      'https://our-reader-git-edge-tts-background-audio-xm-an-towfiqul.vercel.app/auth/callback',
    );
  });

  it('returns the callback on the production origin', () => {
    expect(getWebAuthCallbackUrl('https://our-reader.vercel.app')).toBe(
      'https://our-reader.vercel.app/auth/callback',
    );
  });
});
