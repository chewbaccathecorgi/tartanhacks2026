/**
 * In-memory face profile store.
 *
 * Each profile represents a UNIQUE PERSON. Multiple captures of the
 * same person are grouped into one profile via Azure Face API identification.
 *
 * Uses globalThis so the data survives Next.js HMR in dev mode.
 */

export interface FaceImage {
  id: string;
  imageData: string;          // base64 JPEG data URL
  capturedAt: string;         // ISO 8601
  azureFaceId?: string;       // Azure persisted face ID (for move/delete ops)
}

export interface Conversation {
  id: string;                 // matches RecordingSession.id
  title: string;              // auto-generated
  date: string;               // ISO 8601 (start time)
  endDate: string | null;     // ISO 8601 (end time)
  audioData: string | null;   // base64 audio blob
  profileIds: string[];       // all people in this conversation
}

export interface FaceProfile {
  id: string;
  name: string;               // "Face 1", editable
  description: string;        // user notes, editable
  images: FaceImage[];        // all captures of this person
  azurePersonId: string | null; // Azure PersonGroup Person ID
  capturedAt: string;         // first seen
  conversations: Conversation[];  // recordings this person appeared in
}

export interface RecordingSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
  profileIds: string[];       // profiles seen during this recording
  audioData: string | null;   // base64 audio blob (set when stopped)
}

// ─── Global state (survives HMR) ───────────────────────────────────
const g = globalThis as unknown as {
  __faceProfiles: FaceProfile[];
  __faceCounter: number;
  __recordings: RecordingSession[];
};
if (!g.__faceProfiles) g.__faceProfiles = [];
if (!g.__faceCounter) g.__faceCounter = 0;
if (!g.__recordings) g.__recordings = [];

// ─── Face profile operations ────────────────────────────────────────

export function getAllFaces(): FaceProfile[] {
  return g.__faceProfiles;
}

export function getFaceById(id: string): FaceProfile | null {
  return g.__faceProfiles.find((f) => f.id === id) ?? null;
}

/** Find a profile by its Azure Person ID */
export function findByAzurePersonId(azurePersonId: string): FaceProfile | null {
  return g.__faceProfiles.find((f) => f.azurePersonId === azurePersonId) ?? null;
}

/**
 * Add a face image to an existing profile (matched by Azure Identify).
 */
export function addImageToProfile(
  profileId: string,
  imageData: string,
  azureFaceId?: string
): FaceProfile | null {
  const profile = g.__faceProfiles.find((f) => f.id === profileId);
  if (!profile) return null;
  profile.images.push({
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    imageData,
    capturedAt: new Date().toISOString(),
    azureFaceId,
  });
  return profile;
}

/**
 * Simple fallback: add a face and always create a new profile.
 * Used when Azure is unavailable — the user can merge manually later.
 *
 * Returns { profile, isNew: true } always.
 */
export function addFaceSimple(
  imageData: string
): { profile: FaceProfile; isNew: boolean } {
  const profile = createProfile(imageData);
  return { profile, isNew: true };
}

/**
 * Create a brand-new profile for an unknown person.
 */
export function createProfile(
  imageData: string,
  azurePersonId: string | null = null,
  azureFaceId?: string
): FaceProfile {
  g.__faceCounter += 1;
  const profile: FaceProfile = {
    id: `person_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `Face ${g.__faceCounter}`,
    description: '',
    images: [
      {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        imageData,
        capturedAt: new Date().toISOString(),
        azureFaceId,
      },
    ],
    azurePersonId,
    capturedAt: new Date().toISOString(),
    conversations: [],
  };
  g.__faceProfiles.push(profile);
  return profile;
}

export function updateFace(
  id: string,
  updates: { name?: string; description?: string }
): FaceProfile | null {
  const face = g.__faceProfiles.find((f) => f.id === id);
  if (!face) return null;
  if (updates.name !== undefined) face.name = updates.name;
  if (updates.description !== undefined) face.description = updates.description;
  return face;
}

export function deleteFace(id: string): boolean {
  const idx = g.__faceProfiles.findIndex((f) => f.id === id);
  if (idx === -1) return false;
  g.__faceProfiles.splice(idx, 1);
  return true;
}

// ─── Photo management (move / split / delete) ──────────────────────

/**
 * Move a single photo from one profile to another.
 * Returns the moved FaceImage or null if not found.
 */
export function movePhoto(
  fromProfileId: string,
  toProfileId: string,
  imageId: string
): FaceImage | null {
  const from = g.__faceProfiles.find((f) => f.id === fromProfileId);
  const to = g.__faceProfiles.find((f) => f.id === toProfileId);
  if (!from || !to) return null;

  const imgIdx = from.images.findIndex((img) => img.id === imageId);
  if (imgIdx === -1) return null;

  const [img] = from.images.splice(imgIdx, 1);
  to.images.push(img);
  return img;
}

/**
 * Delete a single photo from a profile.
 * Returns the deleted FaceImage or null.
 */
export function deletePhoto(
  profileId: string,
  imageId: string
): FaceImage | null {
  const profile = g.__faceProfiles.find((f) => f.id === profileId);
  if (!profile) return null;

  const imgIdx = profile.images.findIndex((img) => img.id === imageId);
  if (imgIdx === -1) return null;

  const [img] = profile.images.splice(imgIdx, 1);
  return img;
}

/**
 * Split selected photos from a profile into a new profile.
 * Returns the newly created profile.
 */
export function splitProfile(
  sourceProfileId: string,
  imageIds: string[],
  azurePersonId: string | null = null
): FaceProfile | null {
  const source = g.__faceProfiles.find((f) => f.id === sourceProfileId);
  if (!source) return null;

  const toMove: FaceImage[] = [];
  const remaining: FaceImage[] = [];

  for (const img of source.images) {
    if (imageIds.includes(img.id)) {
      toMove.push(img);
    } else {
      remaining.push(img);
    }
  }

  if (toMove.length === 0) return null;

  source.images = remaining;

  g.__faceCounter += 1;
  const newProfile: FaceProfile = {
    id: `person_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `Face ${g.__faceCounter}`,
    description: '',
    images: toMove,
    azurePersonId,
    capturedAt: toMove[0].capturedAt,
    conversations: [],
  };
  g.__faceProfiles.push(newProfile);
  return newProfile;
}

/**
 * Merge multiple profiles into one (the first one in the list).
 * Returns the merged profile.
 */
export function mergeProfiles(profileIds: string[]): FaceProfile | null {
  if (profileIds.length < 2) return null;

  const primary = g.__faceProfiles.find((f) => f.id === profileIds[0]);
  if (!primary) return null;

  for (let i = 1; i < profileIds.length; i++) {
    const other = g.__faceProfiles.find((f) => f.id === profileIds[i]);
    if (!other) continue;

    // Move all images
    for (const img of other.images) {
      primary.images.push(img);
    }

    // Move conversations (avoid duplicates)
    for (const conv of other.conversations) {
      if (!primary.conversations.some((c) => c.id === conv.id)) {
        primary.conversations.push(conv);
      }
    }

    // Keep the earlier capturedAt
    if (other.capturedAt < primary.capturedAt) {
      primary.capturedAt = other.capturedAt;
    }

    // If primary has default name and other has custom, use other's
    if (primary.name.startsWith('Face ') && !other.name.startsWith('Face ')) {
      primary.name = other.name;
    }
    if (!primary.description && other.description) {
      primary.description = other.description;
    }

    // Remove the merged profile
    const idx = g.__faceProfiles.findIndex((f) => f.id === other.id);
    if (idx !== -1) g.__faceProfiles.splice(idx, 1);
  }

  return primary;
}

// ─── Recording sessions ─────────────────────────────────────────────

export function startRecording(): RecordingSession {
  const session: RecordingSession = {
    id: `rec_${Date.now()}`,
    startedAt: new Date().toISOString(),
    endedAt: null,
    active: true,
    profileIds: [],
    audioData: null,
  };
  g.__recordings.push(session);
  return session;
}

export function stopRecording(
  id: string,
  audioData?: string | null
): RecordingSession | null {
  const session = g.__recordings.find((r) => r.id === id);
  if (!session) return null;
  session.endedAt = new Date().toISOString();
  session.active = false;
  if (audioData) session.audioData = audioData;

  // Link this recording as a conversation to each seen profile
  if (session.profileIds.length > 0) {
    const conversation: Conversation = {
      id: session.id,
      title: `Recording — ${new Date(session.startedAt).toLocaleString()}`,
      date: session.startedAt,
      endDate: session.endedAt,
      audioData: session.audioData,
      profileIds: [...session.profileIds],
    };

    for (const pid of session.profileIds) {
      const profile = g.__faceProfiles.find((p) => p.id === pid);
      if (profile) {
        // Avoid duplicate
        if (!profile.conversations.some((c) => c.id === session.id)) {
          profile.conversations.push(conversation);
        }
      }
    }
  }

  return session;
}

/** Add a profile ID to the active recording session */
export function addProfileToRecording(
  recordingId: string,
  profileId: string
): void {
  const session = g.__recordings.find((r) => r.id === recordingId);
  if (session && !session.profileIds.includes(profileId)) {
    session.profileIds.push(profileId);
  }
}

export function getActiveRecording(): RecordingSession | null {
  return g.__recordings.find((r) => r.active) ?? null;
}

export function getAllRecordings(): RecordingSession[] {
  return g.__recordings;
}

/** Get all recordings that include a given profile */
export function getRecordingsForProfile(profileId: string): RecordingSession[] {
  return g.__recordings.filter((r) => r.profileIds.includes(profileId));
}
