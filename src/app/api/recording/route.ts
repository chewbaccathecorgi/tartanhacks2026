import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveRecording,
  startRecording,
  stopRecording,
  addProfileToRecording,
  getAllRecordings,
} from '@/lib/faceStore';

// GET /api/recording — get active recording status
export async function GET() {
  const active = getActiveRecording();
  return NextResponse.json({
    active: active ?? null,
    all: getAllRecordings().map((r) => ({
      ...r,
      audioData: undefined, // don't send audio blobs in list
    })),
  });
}

// POST /api/recording — toggle recording on/off, or add profile
// Body (toggle):     {} or { action: "toggle" }
// Body (stop+audio): { action: "stop", audioData: "base64..." }
// Body (addProfile): { action: "addProfile", profileId: "..." }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body = toggle
  }

  const action = (body.action as string) || 'toggle';

  // ─── Add profile to active recording ──────────────────────────
  if (action === 'addProfile') {
    const active = getActiveRecording();
    const profileId = body.profileId as string;
    if (!active) {
      return NextResponse.json({ error: 'No active recording' }, { status: 400 });
    }
    if (!profileId) {
      return NextResponse.json({ error: 'profileId required' }, { status: 400 });
    }
    addProfileToRecording(active.id, profileId);
    return NextResponse.json({ ok: true, session: active });
  }

  // ─── Stop with audio ──────────────────────────────────────────
  if (action === 'stop') {
    const active = getActiveRecording();
    if (!active) {
      return NextResponse.json({ error: 'No active recording' }, { status: 400 });
    }
    const audioData = (body.audioData as string) || null;
    const stopped = stopRecording(active.id, audioData);
    console.log(`[Recording] Stopped: ${stopped?.id} (${stopped?.profileIds.length} profiles, audio: ${audioData ? 'yes' : 'no'})`);
    return NextResponse.json({ action: 'stopped', session: { ...stopped, audioData: undefined } });
  }

  // ─── Toggle ───────────────────────────────────────────────────
  const active = getActiveRecording();

  if (active) {
    // Stop current recording (no audio — legacy toggle)
    const stopped = stopRecording(active.id);
    console.log(`[Recording] Stopped: ${stopped?.id}`);
    return NextResponse.json({ action: 'stopped', session: { ...stopped, audioData: undefined } });
  } else {
    // Start new recording
    const session = startRecording();
    console.log(`[Recording] Started: ${session.id}`);
    return NextResponse.json({ action: 'started', session });
  }
}
