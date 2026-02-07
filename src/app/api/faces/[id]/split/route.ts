import { NextRequest, NextResponse } from 'next/server';
import { getFaceById, splitProfile } from '@/lib/faceStore';
import {
  createPerson,
  addPersistedFace,
  removePersistedFace,
  trainPersonGroup,
} from '@/lib/azureFace';

// POST /api/faces/[id]/split — split selected photos into a new profile
// Body: { imageIds: ["img1", "img2", ...] }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceProfileId } = await params;

  try {
    const body = await req.json();
    const { imageIds } = body as { imageIds: string[] };

    if (!imageIds || imageIds.length === 0) {
      return NextResponse.json(
        { error: 'imageIds array is required' },
        { status: 400 }
      );
    }

    const sourceProfile = getFaceById(sourceProfileId);
    if (!sourceProfile) {
      return NextResponse.json({ error: 'Source profile not found' }, { status: 404 });
    }

    // Create a new Azure Person for the split profile
    let azurePersonId: string | null = null;
    try {
      azurePersonId = await createPerson(`Person_${Date.now()}`);
    } catch {
      console.warn('[Split] Failed to create Azure Person for split');
    }

    // Get images before split to handle Azure persisted faces
    const imagesToMove = sourceProfile.images.filter((img) =>
      imageIds.includes(img.id)
    );

    // Remove persisted faces from source Azure Person and add to new one
    for (const img of imagesToMove) {
      if (sourceProfile.azurePersonId && img.azureFaceId) {
        await removePersistedFace(sourceProfile.azurePersonId, img.azureFaceId).catch(() => {});
      }
      if (azurePersonId) {
        const newFaceId = await addPersistedFace(azurePersonId, img.imageData);
        if (newFaceId) img.azureFaceId = newFaceId;
      }
    }

    // Perform local split
    const newProfile = splitProfile(sourceProfileId, imageIds, azurePersonId);
    if (!newProfile) {
      return NextResponse.json({ error: 'Split failed' }, { status: 500 });
    }

    // Re-train
    trainPersonGroup().catch(() => {});

    console.log(
      `[Split] Created "${newProfile.name}" (${newProfile.id}) with ${imageIds.length} photos from "${sourceProfile.name}"`
    );

    return NextResponse.json({
      newProfile: {
        ...newProfile,
        images: undefined,
        imageCount: newProfile.images.length,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
