// `interactive-widget=resizes-content` makes Android Chrome shrink the
// layout viewport when the on-screen keyboard opens, matching iOS
// default behavior so `fixed inset-0`-centered modals (passphrase
// prompt, group picker, etc.) sit above the keyboard. Other browsers
// (Safari on macOS/iOS, desktop Chrome, Firefox) emit a console warning
// when they encounter the unrecognized key on every page load — so we
// only attach it on Android.
export const getAndroidPatchedViewportContent = (
  userAgent: string,
  currentContent: string,
): string | null => {
  if (!/android/i.test(userAgent)) return null;
  if (currentContent.includes('interactive-widget=')) return null;
  const trimmed = currentContent.trim().replace(/,\s*$/, '');
  if (!trimmed) return 'interactive-widget=resizes-content';
  return `${trimmed}, interactive-widget=resizes-content`;
};

// The web build serves a scalable viewport so users can pinch-zoom the
// page. The Tauri mobile shell keeps the historic no-zoom viewport so
// page pinch-zoom cannot fight the reader's own zoom gestures —
// re-applied client-side, only under Tauri, never on the web.
export const getTauriLockedViewportContent = (
  isTauri: boolean,
  currentContent: string,
): string | null => {
  if (!isTauri) return null;
  if (currentContent.includes('user-scalable=no')) return null;
  const trimmed = currentContent.trim().replace(/,\s*$/, '');
  if (!trimmed) return 'maximum-scale=1, user-scalable=no';
  return `${trimmed}, maximum-scale=1, user-scalable=no`;
};
