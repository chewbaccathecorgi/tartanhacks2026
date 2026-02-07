import { NextRequest, NextResponse } from 'next/server';
import { getAllRecordings } from '@/lib/faceStore';

// GET /api/recording/[id] — get a single recording (with audio data)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const recording = getAllRecordings().find((r) => r.id === id);

  if (!recording) {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  }

  return NextResponse.json({ recording });
}
