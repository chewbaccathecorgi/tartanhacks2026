import { NextRequest, NextResponse } from 'next/server';
import { getFaceById, movePhoto } from '@/lib/faceStore';
import {
  addPersistedFace,
  removePersistedFace,
  trainPersonGroup,
} from '@/lib/azureFace';

// POST /api/faces/[id]/move — move a photo from this profile to another
// Body: { imageId: "...", targetProfileId: "..." }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceProfileId } = await params;

  try {
    const body = await req.json();
    const { imageId, targetProfileId } = body;

    if (!imageId || !targetProfileId) {
      return NextResponse.json(
        { error: 'imageId and targetProfileId are required' },
        { status: 400 }
      );
    }

    const sourceProfile = getFaceById(sourceProfileId);
    const targetProfile = getFaceById(targetProfileId);

    if (!sourceProfile) {
      return NextResponse.json({ error: 'Source profile not found' }, { status: 404 });
    }
    if (!targetProfile) {
      return NextResponse.json({ error: 'Target profile not found' }, { status: 404 });
    }

    // Find the image to get its data before moving
    const img = sourceProfile.images.find((i) => i.id === imageId);
    if (!img) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Move persisted face in Azure
    if (sourceProfile.azurePersonId && img.azureFaceId) {
      await removePersistedFace(sourceProfile.azurePersonId, img.azureFaceId).catch(() => {});
    }
    if (targetProfile.azurePersonId) {
      const newFaceId = await addPersistedFace(targetProfile.azurePersonId, img.imageData);
      if (newFaceId) img.azureFaceId = newFaceId;
    }

    // Move in local store
    const moved = movePhoto(sourceProfileId, targetProfileId, imageId);
    if (!moved) {
      return NextResponse.json({ error: 'Move failed' }, { status: 500 });
    }

    // Re-train
    trainPersonGroup().catch(() => {});

    console.log(`[Move] Photo ${imageId} moved from ${sourceProfile.name} to ${targetProfile.name}`);

    return NextResponse.json({ ok: true, movedImage: imageId });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
