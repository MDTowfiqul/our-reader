import { NextRequest, NextResponse } from 'next/server';

// Our Reader fork: Readest Voice is removed — this fork has no
// readest-voice worker. This route intentionally answers 410 so no
// client code ever calls a non-existent voice service. Use Edge TTS,
// system voices, or a user-key custom TTS service instead.
export async function GET(_request: NextRequest) {
  return NextResponse.json({ error: 'READEST_VOICE_REMOVED' }, { status: 410 });
}

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: 'READEST_VOICE_REMOVED' }, { status: 410 });
}
