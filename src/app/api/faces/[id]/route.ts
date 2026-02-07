import { NextRequest, NextResponse } from 'next/server';
import { getFaceById, updateFace, deleteFace, deletePhoto } from '@/lib/faceStore';
import { deletePerson, removePersistedFace } from '@/lib/azureFace';

// GET /api/faces/[id] — full profile with all images
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const face = getFaceById(id);
  if (!face) {
    return NextResponse.json({ error: 'Face not found' }, { status: 404 });
  }
  return NextResponse.json({ face });
}

// PUT /api/faces/[id] — update name / description
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const updated = updateFace(id, {
      name: body.name,
      description: body.description,
    });
    if (!updated) {
      return NextResponse.json({ error: 'Face not found' }, { status: 404 });
    }
    return NextResponse.json({ face: updated });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

// DELETE /api/faces/[id] — delete entire profile (and Azure Person)
// Query param: ?imageId=xxx — delete a single photo instead
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const imageId = req.nextUrl.searchParams.get('imageId');

  // ─── Delete single photo ──
  if (imageId) {
    const face = getFaceById(id);
    if (!face) {
      return NextResponse.json({ error: 'Face not found' }, { status: 404 });
    }
    const deleted = deletePhoto(id, imageId);
    if (!deleted) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    // Remove persisted face from Azure if we have the ID
    if (deleted.azureFaceId && face.azurePersonId) {
      removePersistedFace(face.azurePersonId, deleted.azureFaceId).catch(() => {});
    }
    return NextResponse.json({ ok: true, deletedImage: imageId });
  }

  // ─── Delete entire profile ──
  const face = getFaceById(id);
  if (!face) {
    return NextResponse.json({ error: 'Face not found' }, { status: 404 });
  }

  // Delete Azure Person
  if (face.azurePersonId) {
    deletePerson(face.azurePersonId).catch(() => {});
  }

  const deleted = deleteFace(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Face not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
