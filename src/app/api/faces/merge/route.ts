import { NextRequest, NextResponse } from 'next/server';
import { getAllFaces, mergeProfiles } from '@/lib/faceStore';
import {
  addPersistedFace,
  deletePerson,
  trainPersonGroup,
} from '@/lib/azureFace';

// POST /api/faces/merge — merge selected profiles into one
// Body: { profileIds: ["id1", "id2", ...] }
// The first ID in the array becomes the primary (surviving) profile.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { profileIds } = body as { profileIds: string[] };

    if (!profileIds || profileIds.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 profileIds are required' },
        { status: 400 }
      );
    }

    // Get profiles before merge to track Azure Person IDs
    const allFaces = getAllFaces();
    const profilesToMerge = profileIds
      .map((id) => allFaces.find((f) => f.id === id))
      .filter(Boolean);

    if (profilesToMerge.length < 2) {
      return NextResponse.json(
        { error: 'Could not find at least 2 of the specified profiles' },
        { status: 404 }
      );
    }

    const primaryAzurePersonId = profilesToMerge[0]!.azurePersonId;

    // For each secondary profile's images, add persisted faces to the primary Azure Person
    // Then delete the secondary Azure Persons
    for (let i = 1; i < profilesToMerge.length; i++) {
      const secondary = profilesToMerge[i]!;

      // Add images to primary Azure Person
      if (primaryAzurePersonId) {
        for (const img of secondary.images) {
          try {
            const persistedFaceId = await addPersistedFace(primaryAzurePersonId, img.imageData);
            if (persistedFaceId) {
              img.azureFaceId = persistedFaceId;
            }
          } catch {
            console.warn(`[Merge] Failed to add persisted face for image ${img.id}`);
          }
        }
      }

      // Delete the secondary Azure Person
      if (secondary.azurePersonId) {
        await deletePerson(secondary.azurePersonId).catch(() => {});
      }
    }

    // Perform local merge
    const merged = mergeProfiles(profileIds);
    if (!merged) {
      return NextResponse.json({ error: 'Merge failed' }, { status: 500 });
    }

    // Re-train PersonGroup
    trainPersonGroup().catch(() => {});

    console.log(
      `[Merge] Merged ${profileIds.length} profiles into "${merged.name}" (${merged.id})`
    );

    return NextResponse.json({
      merged: {
        ...merged,
        images: undefined, // don't send all image data back
        imageCount: merged.images.length,
      },
      mergedCount: profileIds.length,
    });
  } catch (err) {
    console.error('[Merge] Failed:', err);
    return NextResponse.json({ error: 'Merge failed' }, { status: 500 });
  }
}
