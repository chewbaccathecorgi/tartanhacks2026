/**
 * Azure Face API client — REST-based wrapper.
 *
 * Provides: detect, identify, PersonGroup CRUD, Person CRUD,
 * add/remove persisted face, train PersonGroup.
 *
 * GRACEFUL DEGRADATION: If the Azure resource lacks approval for
 * Identification/Verification features (403 UnsupportedFeature),
 * the module automatically disables those features and logs once.
 * The app continues working using local matching only.
 */

const ENDPOINT = process.env.AZURE_FACE_ENDPOINT ?? '';
const KEY = process.env.AZURE_FACE_KEY ?? '';
const PERSON_GROUP_ID = 'glasses-stream-people'; // single PersonGroup
const API = `${ENDPOINT}/face/v1.0`;

const jsonHeaders = () => ({
  'Ocp-Apim-Subscription-Key': KEY,
  'Content-Type': 'application/json',
});

const octetHeaders = () => ({
  'Ocp-Apim-Subscription-Key': KEY,
  'Content-Type': 'application/octet-stream',
});

// ─── Feature availability tracking ──────────────────────────────────
// Azure Face API requires special approval for Identification/Verification.
// If the resource lacks it, we disable those features and use local matching.

let _detectAvailable: boolean | null = null;   // null = untested
let _identifyAvailable: boolean | null = null;  // null = untested

export function isDetectAvailable(): boolean {
  return _detectAvailable !== false;
}

export function isIdentifyAvailable(): boolean {
  return _identifyAvailable !== false;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Convert a data-URL (base64) to a Blob for octet-stream upload */
function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  return new Blob([buf]);
}

function isUnsupportedFeatureError(text: string): boolean {
  return text.includes('UnsupportedFeature') || text.includes('missing approval');
}

async function azureFetch(url: string, init: RequestInit): Promise<Response> {
  if (!ENDPOINT || !KEY) {
    // No Azure credentials configured
    return new Response('No Azure credentials', { status: 0 });
  }
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Only log the first occurrence of known blocks, not every call
      if (res.status === 403 && isUnsupportedFeatureError(text)) {
        return new Response(text, { status: 403, statusText: 'Forbidden' });
      }
      console.error(`[Azure] ${init.method ?? 'GET'} ${url} → ${res.status}: ${text}`);
      return new Response(text, { status: res.status });
    }
    return res;
  } catch (err) {
    console.error(`[Azure] Network error: ${err}`);
    return new Response('Network error', { status: 0 });
  }
}

// ─── PersonGroup ────────────────────────────────────────────────────

export async function ensurePersonGroup(): Promise<boolean> {
  if (_identifyAvailable === false) return false;

  const check = await azureFetch(`${API}/persongroups/${PERSON_GROUP_ID}`, {
    method: 'GET',
    headers: jsonHeaders(),
  });

  if (check.ok) {
    _identifyAvailable = true;
    return true;
  }

  if (check.status === 403) {
    const text = await check.text().catch(() => '');
    if (isUnsupportedFeatureError(text) || text.includes('UnsupportedFeature')) {
      console.warn('[Azure] Identification/Verification features not approved. Using local matching only. Apply at https://aka.ms/facerecognition');
      _identifyAvailable = false;
      return false;
    }
  }

  // Try to create it (might be 404 = just doesn't exist yet)
  const create = await azureFetch(`${API}/persongroups/${PERSON_GROUP_ID}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify({
      name: 'Glasses Stream People',
      recognitionModel: 'recognition_04',
    }),
  });

  if (create.ok) {
    console.log('[Azure] PersonGroup created');
    _identifyAvailable = true;
    return true;
  }

  if (create.status === 403) {
    console.warn('[Azure] Identification/Verification features not approved. Using local matching only.');
    _identifyAvailable = false;
    return false;
  }

  console.error('[Azure] Failed to create PersonGroup');
  return false;
}

export async function trainPersonGroup(): Promise<void> {
  if (!isIdentifyAvailable()) return;
  await azureFetch(`${API}/persongroups/${PERSON_GROUP_ID}/train`, {
    method: 'POST',
    headers: jsonHeaders(),
  });
}

export async function getTrainingStatus(): Promise<string> {
  if (!isIdentifyAvailable()) return 'unavailable';
  const res = await azureFetch(
    `${API}/persongroups/${PERSON_GROUP_ID}/training`,
    { method: 'GET', headers: jsonHeaders() }
  );
  if (!res.ok) return 'unknown';
  const data = await res.json();
  return data.status;
}

// ─── Person CRUD ────────────────────────────────────────────────────

export interface AzurePerson {
  personId: string;
  name: string;
  userData?: string;
  persistedFaceIds?: string[];
}

export async function createPerson(name: string): Promise<string | null> {
  if (!isIdentifyAvailable()) return null;
  const res = await azureFetch(
    `${API}/persongroups/${PERSON_GROUP_ID}/persons`,
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.personId ?? null;
}

export async function deletePerson(personId: string): Promise<boolean> {
  if (!isIdentifyAvailable()) return false;
  const res = await azureFetch(
    `${API}/persongroups/${PERSON_GROUP_ID}/persons/${personId}`,
    { method: 'DELETE', headers: jsonHeaders() }
  );
  return res.ok;
}

export async function getPerson(personId: string): Promise<AzurePerson | null> {
  if (!isIdentifyAvailable()) return null;
  const res = await azureFetch(
    `${API}/persongroups/${PERSON_GROUP_ID}/persons/${personId}`,
    { method: 'GET', headers: jsonHeaders() }
  );
  if (!res.ok) return null;
  return await res.json();
}

export async function listPersons(): Promise<AzurePerson[]> {
  if (!isIdentifyAvailable()) return [];
  const res = await azureFetch(
    `${API}/persongroups/${PERSON_GROUP_ID}/persons?top=1000`,
    { method: 'GET', headers: jsonHeaders() }
  );
  if (!res.ok) return [];
  return await res.json();
}

// ─── Persisted Faces ────────────────────────────────────────────────

export async function addPersistedFace(
  personId: string,
  imageDataUrl: string
): Promise<string | null> {
  if (!isIdentifyAvailable()) return null;
  const blob = dataUrlToBlob(imageDataUrl);
  const res = await azureFetch(
    `${API}/persongroups/${PERSON_GROUP_ID}/persons/${personId}/persistedfaces?detectionModel=detection_03`,
    { method: 'POST', headers: octetHeaders(), body: blob }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.persistedFaceId ?? null;
}

export async function removePersistedFace(
  personId: string,
  persistedFaceId: string
): Promise<boolean> {
  if (!isIdentifyAvailable()) return false;
  const res = await azureFetch(
    `${API}/persongroups/${PERSON_GROUP_ID}/persons/${personId}/persistedfaces/${persistedFaceId}`,
    { method: 'DELETE', headers: jsonHeaders() }
  );
  return res.ok;
}

// ─── Detect ─────────────────────────────────────────────────────────

export interface DetectedFaceResult {
  faceId: string;
  faceRectangle: { top: number; left: number; width: number; height: number };
}

/**
 * Detect faces in a base64 image using Azure.
 * Returns:
 *  - { faces: [...], error: false } if detection succeeded
 *  - { faces: [], error: false } if Azure successfully said "no face"
 *  - { faces: [], error: true } if Azure had an error (caller should trust MediaPipe)
 */
export async function detectFaces(
  imageDataUrl: string
): Promise<{ faces: DetectedFaceResult[]; error: boolean }> {
  if (_detectAvailable === false) return { faces: [], error: true };

  const blob = dataUrlToBlob(imageDataUrl);
  const needsFaceId = isIdentifyAvailable();
  const res = await azureFetch(
    `${API}/detect?returnFaceId=${needsFaceId}&detectionModel=detection_03${needsFaceId ? '&recognitionModel=recognition_04&faceIdTimeToLive=600' : ''}`,
    { method: 'POST', headers: octetHeaders(), body: blob }
  );

  if (!res.ok) {
    if (res.status === 403) {
      console.warn('[Azure] Detect feature may not be available');
      _detectAvailable = false;
    }
    // Azure error — NOT the same as "no face"
    return { faces: [], error: true };
  }

  if (_detectAvailable === null) {
    _detectAvailable = true;
    console.log('[Azure] Face Detect is available');
  }

  const faces = await res.json();
  return { faces, error: false };
}

// ─── Identify ───────────────────────────────────────────────────────

export interface IdentifyCandidate {
  personId: string;
  confidence: number;
}

export interface IdentifyResult {
  faceId: string;
  candidates: IdentifyCandidate[];
}

export async function identifyFaces(
  faceIds: string[],
  maxCandidates: number = 1,
  confidenceThreshold: number = 0.5
): Promise<IdentifyResult[]> {
  if (!isIdentifyAvailable() || faceIds.length === 0) {
    return faceIds.map((faceId) => ({ faceId, candidates: [] }));
  }

  const res = await azureFetch(`${API}/identify`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      personGroupId: PERSON_GROUP_ID,
      faceIds,
      maxNumOfCandidatesReturned: maxCandidates,
      confidenceThreshold,
    }),
  });
  if (!res.ok) return faceIds.map((faceId) => ({ faceId, candidates: [] }));
  return await res.json();
}

// ─── Verify (1:1) ───────────────────────────────────────────────────

export async function verifyFace(
  faceId: string,
  personId: string
): Promise<{ isIdentical: boolean; confidence: number } | null> {
  if (!isIdentifyAvailable()) return null;
  const res = await azureFetch(`${API}/verify`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ faceId, personId, personGroupId: PERSON_GROUP_ID }),
  });
  if (!res.ok) return null;
  return await res.json();
}

// ─── Train and wait helper ──────────────────────────────────────────

export async function trainAndWait(maxWaitMs: number = 30000): Promise<boolean> {
  if (!isIdentifyAvailable()) return false;
  await trainPersonGroup();
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await getTrainingStatus();
    if (status === 'succeeded') return true;
    if (status === 'failed') return false;
  }
  console.warn('[Azure] Training still running after timeout');
  return false;
}
