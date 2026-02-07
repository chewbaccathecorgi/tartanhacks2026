import { NextRequest, NextResponse } from 'next/server';
import {
  getAllFaces,
  addImageToProfile,
  createProfile,
  findByAzurePersonId,
} from '@/lib/faceStore';
import {
  detectFaces,
  identifyFaces,
  ensurePersonGroup,
  createPerson,
  addPersistedFace,
  trainPersonGroup,
  isIdentifyAvailable,
  isDetectAvailable,
} from '@/lib/azureFace';

// Track whether we've attempted Azure setup this session
let azureChecked = false;

// GET /api/faces — return all profiles (without heavy image data in list)
export async function GET(req: NextRequest) {
  const faces = getAllFaces();
  const compact = req.nextUrl.searchParams.get('compact') !== 'false';

  if (compact) {
    return NextResponse.json({
      faces: faces.map((f) => ({
        ...f,
        thumbnail: f.images[0]?.imageData ?? null,
        imageCount: f.images.length,
        images: undefined,
      })),
    });
  }

  return NextResponse.json({ faces });
}

// POST /api/faces — add a face capture
// Body: { imageData: "data:image/jpeg;base64,..." }
//
// ARCHITECTURE:
// 1. MediaPipe in the browser already validated this is a face (bounding box + crop)
// 2. We ALWAYS store the face locally — never reject based on Azure failure
// 3. Azure Detect is used as optional extra validation (reject hands/noise)
// 4. Azure Identify is used for deduplication IF the feature is approved
// 5. If Azure is unavailable → face is stored, user merges/splits manually
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageData } = body;

    if (!imageData || typeof imageData !== 'string') {
      return NextResponse.json(
        { error: 'imageData (base64 string) is required' },
        { status: 400 }
      );
    }

    // ── Try Azure setup once (non-blocking) ──
    if (!azureChecked) {
      azureChecked = true;
      try {
        await ensurePersonGroup();
        if (isIdentifyAvailable()) {
          console.log('[API] Azure Identify features available — using Azure deduplication');
        } else {
          console.log('[API] Azure Identify not available — faces stored locally, manual merge available');
        }
      } catch {
        console.log('[API] Azure check failed — running in local-only mode');
      }
    }

    // ── Step 1: Azure Detect (optional face validation) ──
    let azureFaceId: string | null = null;

    if (isDetectAvailable()) {
      try {
        const { faces: detectedFaces, error: detectError } = await detectFaces(imageData);
        if (!detectError && detectedFaces.length === 0) {
          // Azure successfully processed the image and found NO face — skip
          console.log('[API] Azure Detect: no face found — skipping');
          return NextResponse.json(
            { error: 'No face detected in image', skipped: true },
            { status: 422 }
          );
        }
        if (detectError) {
          // Azure had an error processing the image — trust MediaPipe, store anyway
          console.log('[API] Azure Detect error — trusting MediaPipe, storing anyway');
        } else {
          azureFaceId = detectedFaces[0].faceId;
          console.log(`[API] Azure detected face: ${azureFaceId}`);
        }
      } catch {
        // Azure detect threw — trust MediaPipe and continue
        console.log('[API] Azure Detect exception — trusting MediaPipe, storing anyway');
      }
    }

    // ── Step 2: Azure Identify (optional deduplication) ──
    if (azureFaceId && isIdentifyAvailable()) {
      try {
        const identifyResults = await identifyFaces([azureFaceId]);
        const result = identifyResults[0];

        if (result && result.candidates.length > 0) {
          const best = result.candidates[0];
          console.log(
            `[API] Azure identified: personId=${best.personId}, confidence=${best.confidence.toFixed(3)}`
          );

          const matchedProfile = findByAzurePersonId(best.personId);
          if (matchedProfile) {
            const persistedFaceId = await addPersistedFace(best.personId, imageData).catch(() => null);
            addImageToProfile(matchedProfile.id, imageData, persistedFaceId ?? undefined);
            console.log(
              `[API] Added to existing profile: ${matchedProfile.name} — ${matchedProfile.images.length} images`
            );
            trainPersonGroup().catch(() => {});

            return NextResponse.json(
              { face: matchedProfile, isNew: false },
              { status: 200 }
            );
          }
        }
      } catch (err) {
        console.log('[API] Azure Identify failed, creating new profile:', err);
      }
    }

    // ── Step 3: No Azure match (or Azure unavailable) — create new profile ──
    let azurePersonId: string | null = null;

    if (isIdentifyAvailable()) {
      try {
        azurePersonId = await createPerson(`Person_${Date.now()}`);
        if (azurePersonId) {
          const persistedFaceId = await addPersistedFace(azurePersonId, imageData).catch(() => null);
          const profile = createProfile(imageData, azurePersonId, persistedFaceId ?? undefined);
          console.log(`[API] New profile: ${profile.name} (${profile.id}), azurePerson=${azurePersonId}`);
          trainPersonGroup().catch(() => {});
          return NextResponse.json({ face: profile, isNew: true }, { status: 201 });
        }
      } catch {
        console.log('[API] Azure Person creation failed, storing locally only');
      }
    }

    // ── Fallback: store locally without Azure ──
    const profile = createProfile(imageData);
    console.log(`[API] New local profile: ${profile.name} (${profile.id}) — no Azure link`);

    return NextResponse.json({ face: profile, isNew: true }, { status: 201 });
  } catch (err) {
    console.error('[API] Failed to add face:', err);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
