import { describe, it, expect, vi, afterEach } from 'vitest';
import { jwtDecode } from 'jwt-decode';
import {
  getCustomizationPurchased,
  isCustomizationAllowed,
  isCustomTranslatorAllowed,
  isSelfHosted,
} from '@/utils/access';

vi.mock('jwt-decode', () => ({ jwtDecode: vi.fn() }));

const mockToken = (claims: Record<string, unknown>) => {
  (jwtDecode as unknown as ReturnType<typeof vi.fn>).mockReturnValue(claims);
  return 'token';
};

describe('getCustomizationPurchased', () => {
  it('reads the claim minted by custom_access_token_hook', () => {
    expect(getCustomizationPurchased(mockToken({ customization_purchased: true }))).toBe(true);
  });

  it('is false when the claim is absent, so old tokens do not unlock it', () => {
    expect(getCustomizationPurchased(mockToken({ plan: 'free' }))).toBe(false);
  });
});

// Our Reader fork: every feature is free, regardless of plan or purchase.
// The gate functions are kept (call sites unchanged) and now always allow.
describe('isCustomizationAllowed', () => {
  it('allows every plan, with or without a purchase', () => {
    expect(isCustomizationAllowed('free', false)).toBe(true);
    expect(isCustomizationAllowed('free', true)).toBe(true);
    expect(isCustomizationAllowed('plus', false)).toBe(true);
    expect(isCustomizationAllowed('pro', false)).toBe(true);
    expect(isCustomizationAllowed('purchase', false)).toBe(true);
  });
});

// A self-hosted deployment has no store to buy from, and the operator already
// runs the infrastructure the paywall funds, so everything is unlocked.
describe('self-hosted deployments', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default', () => {
    expect(isSelfHosted()).toBe(false);
  });

  it('unlocks premium for a signed-in free user with no purchase', () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  it('unlocks premium with no login at all, where the plan reads free', () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  // `??` stops at an empty string, so a blank SELF_HOSTED would mask the
  // public variable and silently re-lock a self-hosted deployment.
  it('falls through an explicitly empty SELF_HOSTED', () => {
    vi.stubEnv('SELF_HOSTED', '');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isSelfHosted()).toBe(true);
  });
});

// Custom translators (the user's own LLM endpoint or DeepL key) are free in
// the fork, like every other premium feature. The reader decides from the
// session token alone, so a signed-out reader is a free reader: allowed.
describe('isCustomTranslatorAllowed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows a subscriber', () => {
    expect(isCustomTranslatorAllowed(mockToken({ plan: 'plus' }))).toBe(true);
  });

  it('allows a free user, with or without a purchase', () => {
    expect(isCustomTranslatorAllowed(mockToken({ customization_purchased: true }))).toBe(true);
    expect(isCustomTranslatorAllowed(mockToken({ plan: 'free' }))).toBe(true);
    expect(
      isCustomTranslatorAllowed(mockToken({ plan: 'free', storage_purchased_bytes: 1e9 })),
    ).toBe(true);
  });

  it('allows a signed-out reader', () => {
    expect(isCustomTranslatorAllowed(null)).toBe(true);
    expect(isCustomTranslatorAllowed(undefined)).toBe(true);
  });
});
