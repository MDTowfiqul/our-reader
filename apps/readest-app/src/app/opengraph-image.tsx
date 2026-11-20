import { ImageResponse } from 'next/og';

// Open Graph preview image for Our Reader (1200x630).
// This replaces the old upstream image that was still hosted on
// cdn.readest.com and showed the Readest landing page in link previews.
// Next.js serves this at /opengraph-image and picks it up automatically
// for both openGraph and twitter metadata.
// The Tauri build uses `output: 'export'` (static export), which requires
// image routes to be statically configured.
export const dynamic = 'force-static';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';
export const alt = 'Our Reader — Where You Read, Digest and Get Insight';

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#0b3d2e',
        padding: '64px 72px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: 6,
            color: '#d4a437',
            fontWeight: 700,
            marginBottom: 28,
          }}
        >
          OUR READER
        </div>
        <div
          style={{
            fontSize: 60,
            lineHeight: 1.05,
            color: '#ffffff',
            fontWeight: 800,
          }}
        >
          Where You Read,
        </div>
        <div
          style={{
            fontSize: 60,
            lineHeight: 1.05,
            color: '#ffffff',
            fontWeight: 800,
            marginBottom: 28,
          }}
        >
          Digest and Get Insight.
        </div>
        <div
          style={{
            width: 120,
            height: 6,
            backgroundColor: '#d4a437',
            borderRadius: 3,
            marginBottom: 28,
          }}
        />
        <div
          style={{
            fontSize: 32,
            color: '#b8d8c8',
          }}
        >
          EPUB · PDF · Sync across devices
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          width: 280,
          height: 360,
          backgroundColor: '#f5efe0',
          borderRadius: 18,
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 138,
            top: 0,
            width: 4,
            height: 360,
            backgroundColor: '#d8cdb2',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 36,
            top: 48,
            width: 88,
            height: 12,
            backgroundColor: '#9db8a8',
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 36,
            top: 80,
            width: 88,
            height: 12,
            backgroundColor: '#c3d4c8',
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 36,
            top: 112,
            width: 88,
            height: 12,
            backgroundColor: '#c3d4c8',
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 36,
            top: 48,
            width: 88,
            height: 12,
            backgroundColor: '#9db8a8',
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 36,
            top: 80,
            width: 88,
            height: 12,
            backgroundColor: '#c3d4c8',
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 36,
            top: 112,
            width: 88,
            height: 12,
            backgroundColor: '#c3d4c8',
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 60,
            top: 0,
            width: 36,
            height: 96,
            backgroundColor: '#d4a437',
          }}
        />
      </div>
    </div>,
    {
      ...size,
    },
  );
}
