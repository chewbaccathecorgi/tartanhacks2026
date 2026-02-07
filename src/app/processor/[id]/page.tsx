'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

interface FaceImage {
  id: string;
  imageData: string;
  capturedAt: string;
}

interface Conversation {
  id: string;
  title: string;
  date: string;
  endDate: string | null;
  audioData: string | null;
  profileIds: string[];
}

interface FaceProfile {
  id: string;
  name: string;
  description: string;
  images: FaceImage[];
  capturedAt: string;
  conversations: Conversation[];
}

interface FaceCompact {
  id: string;
  name: string;
  thumbnail: string | null;
}

const MAX_VISIBLE_PHOTOS = 6;

// ─── Audio Player Component ─────────────────────────────────────────
function AudioPlayer({ audioData }: { audioData: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  };

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={audioStyles.container}>
      <audio
        ref={audioRef}
        src={audioData}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
      />
      <button onClick={toggle} style={audioStyles.playBtn}>
        {playing ? '⏸' : '▶'}
      </button>
      <div style={audioStyles.progressWrap}>
        <div style={audioStyles.progressTrack}>
          <div
            style={{
              ...audioStyles.progressFill,
              width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
            }}
          />
        </div>
        <div style={audioStyles.timeRow}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

const audioStyles: { [key: string]: React.CSSProperties } = {
  container: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px', backgroundColor: '#1a1a1a',
    borderRadius: '8px', marginTop: '8px',
  },
  playBtn: {
    width: '40px', height: '40px', borderRadius: '50%',
    backgroundColor: '#3b82f6', color: '#fff', border: 'none',
    fontSize: '16px', cursor: 'pointer', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  progressWrap: { flex: 1 },
  progressTrack: {
    width: '100%', height: '4px', backgroundColor: '#333',
    borderRadius: '2px', overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: '#3b82f6',
    borderRadius: '2px', transition: 'width 0.1s',
  },
  timeRow: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: '11px', color: '#666', marginTop: '4px',
  },
};

// ─── Move Modal ──────────────────────────────────────────────────────
function MoveModal({
  profiles,
  currentProfileId,
  onSelect,
  onClose,
}: {
  profiles: FaceCompact[];
  currentProfileId: string;
  onSelect: (targetId: string) => void;
  onClose: () => void;
}) {
  const targets = profiles.filter((p) => p.id !== currentProfileId);

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={modalStyles.title}>Move to profile</h3>
        {targets.length === 0 ? (
          <p style={{ color: '#888', fontSize: '14px' }}>No other profiles available</p>
        ) : (
          <div style={modalStyles.list}>
            {targets.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                style={modalStyles.item}
              >
                {p.thumbnail && (
                  <img src={p.thumbnail} alt="" style={modalStyles.thumb} />
                )}
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} style={modalStyles.cancelBtn}>Cancel</button>
      </div>
    </div>
  );
}

const modalStyles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#1a1a1a', borderRadius: '16px', padding: '24px',
    width: '340px', maxHeight: '80vh', overflowY: 'auto',
    border: '1px solid #333',
  },
  title: { fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0', color: '#fff' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  item: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 14px', backgroundColor: '#262626',
    borderRadius: '8px', border: '1px solid #333',
    cursor: 'pointer', color: '#fff', fontSize: '14px',
    textAlign: 'left' as const, width: '100%',
  },
  thumb: { width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' as const },
  cancelBtn: {
    marginTop: '16px', padding: '10px 16px', width: '100%',
    backgroundColor: '#333', color: '#aaa', border: 'none',
    borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
  },
};

// ─── Profile Page ───────────────────────────────────────────────────
export default function ProfilePage() {
  const params = useParams();
  const id = params.id as string;

  const [profile, setProfile] = useState<FaceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [descVal, setDescVal] = useState('');
  const [showAllPhotos, setShowAllPhotos] = useState(false);

  // Selection mode for split
  const [selectMode, setSelectMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  // Move modal
  const [moveImageId, setMoveImageId] = useState<string | null>(null);
  const [allProfiles, setAllProfiles] = useState<FaceCompact[]>([]);

  // Status toast
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`/api/faces/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProfile(data.face);
      }
    } catch { /* retry */ }
    setLoading(false);
  }, [id]);

  const fetchAllProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/faces');
      if (res.ok) {
        const data = await res.json();
        setAllProfiles(data.faces);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetchProfile();
    const interval = setInterval(fetchProfile, 3000);
    return () => clearInterval(interval);
  }, [fetchProfile]);

  const saveName = async () => {
    if (!profile) return;
    await fetch(`/api/faces/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameVal }),
    });
    setEditingName(false);
    fetchProfile();
  };

  const saveDesc = async () => {
    if (!profile) return;
    await fetch(`/api/faces/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: descVal }),
    });
    setEditingDesc(false);
    fetchProfile();
  };

  const downloadImage = (img: FaceImage, idx: number) => {
    const link = document.createElement('a');
    link.href = img.imageData;
    link.download = `${profile?.name ?? 'face'}_${idx + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const deleteProfile = async () => {
    if (!confirm('Delete this profile and all photos?')) return;
    await fetch(`/api/faces/${id}`, { method: 'DELETE' });
    window.location.href = '/processor';
  };

  const deletePhoto = async (imageId: string) => {
    if (!confirm('Delete this photo?')) return;
    const res = await fetch(`/api/faces/${id}?imageId=${imageId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Photo deleted');
      fetchProfile();
    }
  };

  const movePhoto = async (targetProfileId: string) => {
    if (!moveImageId) return;
    const res = await fetch(`/api/faces/${id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: moveImageId, targetProfileId }),
    });
    if (res.ok) {
      showToast('Photo moved');
      setMoveImageId(null);
      fetchProfile();
    }
  };

  const handleMoveClick = async (imageId: string) => {
    await fetchAllProfiles();
    setMoveImageId(imageId);
  };

  const toggleSelection = (imageId: string) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const splitSelected = async () => {
    if (selectedImages.size === 0) return;
    if (!confirm(`Split ${selectedImages.size} photo(s) into a new profile?`)) return;

    const res = await fetch(`/api/faces/${id}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageIds: Array.from(selectedImages) }),
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`Created new profile: ${data.newProfile?.name ?? 'Unknown'}`);
      setSelectMode(false);
      setSelectedImages(new Set());
      fetchProfile();
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ padding: '80px', textAlign: 'center', color: '#666' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={styles.container}>
        <div style={{ padding: '80px', textAlign: 'center', color: '#666' }}>
          <h2>Profile not found</h2>
          <a href="/processor" style={{ color: '#8b5cf6' }}>Back to People</a>
        </div>
      </div>
    );
  }

  const visiblePhotos = showAllPhotos
    ? profile.images
    : profile.images.slice(0, MAX_VISIBLE_PHOTOS);
  const hasMore = profile.images.length > MAX_VISIBLE_PHOTOS && !showAllPhotos;

  return (
    <div style={styles.container}>
      {/* Move modal */}
      {moveImageId && (
        <MoveModal
          profiles={allProfiles}
          currentProfileId={id}
          onSelect={movePhoto}
          onClose={() => setMoveImageId(null)}
        />
      )}

      {/* Toast */}
      {toast && <div style={styles.toast}>{toast}</div>}

      {/* Header */}
      <header style={styles.header}>
        <a href="/processor" style={styles.backLink}>
          ← People
        </a>
        <div style={{ display: 'flex', gap: '8px' }}>
          {selectMode ? (
            <>
              <button
                onClick={splitSelected}
                disabled={selectedImages.size === 0}
                style={{
                  ...styles.splitBtn,
                  opacity: selectedImages.size > 0 ? 1 : 0.4,
                }}
              >
                Split {selectedImages.size > 0 ? `(${selectedImages.size})` : ''}
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelectedImages(new Set()); }}
                style={styles.cancelSelectBtn}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {profile.images.length > 1 && (
                <button
                  onClick={() => setSelectMode(true)}
                  style={styles.splitModeBtn}
                >
                  Split
                </button>
              )}
              <button onClick={deleteProfile} style={styles.deleteBtn}>
                Delete Profile
              </button>
            </>
          )}
        </div>
      </header>

      <main style={styles.main}>
        {/* Profile hero */}
        <div style={styles.hero}>
          <div style={styles.avatar}>
            {profile.images[0] ? (
              <img
                src={profile.images[0].imageData}
                alt={profile.name}
                style={styles.avatarImg}
              />
            ) : (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="8" r="4" />
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              </svg>
            )}
          </div>

          <div style={styles.heroInfo}>
            {/* Editable name */}
            {editingName ? (
              <div style={styles.editRow}>
                <input
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  style={styles.editInput}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && saveName()}
                />
                <button onClick={saveName} style={styles.saveBtn}>Save</button>
                <button onClick={() => setEditingName(false)} style={styles.cancelBtn}>
                  Cancel
                </button>
              </div>
            ) : (
              <h1
                style={styles.heroName}
                onClick={() => { setEditingName(true); setNameVal(profile.name); }}
                title="Click to edit"
              >
                {profile.name}
                <span style={styles.editHint}>edit</span>
              </h1>
            )}

            {/* Editable description */}
            {editingDesc ? (
              <div style={styles.editRow}>
                <textarea
                  value={descVal}
                  onChange={(e) => setDescVal(e.target.value)}
                  style={{ ...styles.editInput, minHeight: '60px' }}
                  autoFocus
                  placeholder="Add a bio or notes..."
                />
                <button onClick={saveDesc} style={styles.saveBtn}>Save</button>
                <button onClick={() => setEditingDesc(false)} style={styles.cancelBtn}>
                  Cancel
                </button>
              </div>
            ) : (
              <p
                style={styles.heroDesc}
                onClick={() => { setEditingDesc(true); setDescVal(profile.description); }}
                title="Click to edit"
              >
                {profile.description || 'Click to add a bio...'}
                <span style={styles.editHint}>edit</span>
              </p>
            )}

            <p style={styles.heroMeta}>
              {profile.images.length} photo{profile.images.length !== 1 ? 's' : ''} •{' '}
              {profile.conversations.length} conversation{profile.conversations.length !== 1 ? 's' : ''} •
              First seen {new Date(profile.capturedAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Photo gallery */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Photos</h2>
            {selectMode && (
              <span style={styles.selectHint}>
                Select photos to split into a new profile
              </span>
            )}
          </div>
          <div style={styles.photoGrid}>
            {visiblePhotos.map((img, idx) => {
              const isSelected = selectedImages.has(img.id);
              return (
                <div
                  key={img.id}
                  style={{
                    ...styles.photoCard,
                    ...(selectMode ? { cursor: 'pointer' } : {}),
                    ...(isSelected ? { border: '2px solid #8b5cf6', boxShadow: '0 0 12px rgba(139, 92, 246, 0.4)' } : {}),
                  }}
                  onClick={selectMode ? () => toggleSelection(img.id) : undefined}
                >
                  {selectMode && (
                    <div style={{
                      ...styles.checkbox,
                      ...(isSelected ? styles.checkboxChecked : {}),
                    }}>
                      {isSelected && '✓'}
                    </div>
                  )}
                  <img src={img.imageData} alt={`${profile.name} #${idx + 1}`}
                    style={styles.photo} />
                  {!selectMode && (
                    <div style={styles.photoOverlay}>
                      <div style={styles.photoActions}>
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadImage(img, idx); }}
                          style={styles.photoActionBtn}
                          title="Download"
                        >
                          ↓
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveClick(img.id); }}
                          style={styles.photoActionBtn}
                          title="Move to another profile"
                        >
                          →
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deletePhoto(img.id); }}
                          style={{ ...styles.photoActionBtn, color: '#ef4444' }}
                          title="Delete photo"
                        >
                          ✕
                        </button>
                      </div>
                      <span style={styles.photoTime}>
                        {new Date(img.capturedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {hasMore && (
            <button
              onClick={() => setShowAllPhotos(true)}
              style={styles.viewAllBtn}
            >
              View all {profile.images.length} photos
            </button>
          )}
        </section>

        {/* Conversations section with audio */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Conversations</h2>
          {profile.conversations.length === 0 ? (
            <div style={styles.emptyConversations}>
              <p style={{ color: '#555', margin: 0 }}>
                No conversations recorded yet.
              </p>
              <p style={{ color: '#444', margin: '4px 0 0 0', fontSize: '12px' }}>
                Show a peace sign during a conversation to start recording.
                Audio and faces will be captured automatically.
              </p>
            </div>
          ) : (
            <div style={styles.conversationList}>
              {profile.conversations.map((conv) => (
                <div key={conv.id} style={styles.conversationCard}>
                  <div style={styles.convHeader}>
                    <h4 style={styles.convTitle}>{conv.title}</h4>
                    {conv.profileIds.length > 1 && (
                      <span style={styles.convPeople}>
                        {conv.profileIds.length} people in this conversation
                      </span>
                    )}
                  </div>
                  <p style={styles.convDate}>
                    {new Date(conv.date).toLocaleString()}
                    {conv.endDate && (
                      <> — {new Date(conv.endDate).toLocaleTimeString()}</>
                    )}
                  </p>
                  {conv.audioData ? (
                    <AudioPlayer audioData={conv.audioData} />
                  ) : (
                    <p style={styles.noAudio}>
                      No audio recorded for this conversation
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    backgroundColor: '#0a0a0a', color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    padding: '16px 24px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', borderBottom: '1px solid #1f1f1f',
  },
  backLink: {
    color: '#8b5cf6', textDecoration: 'none', fontSize: '14px', fontWeight: 500,
  },
  deleteBtn: {
    padding: '6px 14px', fontSize: '12px', color: '#ef4444',
    backgroundColor: 'transparent', border: '1px solid #ef4444',
    borderRadius: '6px', cursor: 'pointer',
  },
  splitModeBtn: {
    padding: '6px 14px', fontSize: '12px', color: '#8b5cf6',
    backgroundColor: 'transparent', border: '1px solid #8b5cf6',
    borderRadius: '6px', cursor: 'pointer',
  },
  splitBtn: {
    padding: '6px 14px', fontSize: '12px', color: '#fff',
    backgroundColor: '#7c3aed', border: 'none',
    borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
  },
  cancelSelectBtn: {
    padding: '6px 14px', fontSize: '12px', color: '#a1a1a1',
    backgroundColor: 'transparent', border: '1px solid #444',
    borderRadius: '6px', cursor: 'pointer',
  },

  toast: {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    padding: '10px 24px', backgroundColor: '#052e16', color: '#22c55e',
    borderRadius: '8px', border: '1px solid #22c55e', fontSize: '14px',
    fontWeight: 500, zIndex: 999,
  },

  main: {
    flex: 1, padding: '32px 24px', maxWidth: '800px',
    margin: '0 auto', width: '100%',
  },

  hero: {
    display: 'flex', gap: '24px', alignItems: 'flex-start',
    marginBottom: '40px', flexWrap: 'wrap',
  },
  avatar: {
    width: '120px', height: '120px', borderRadius: '16px',
    overflow: 'hidden', backgroundColor: '#1a1a1a', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333',
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  heroInfo: { flex: 1, minWidth: '200px' },
  heroName: {
    fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0',
    cursor: 'pointer', position: 'relative',
  },
  heroDesc: {
    fontSize: '14px', color: '#999', margin: '0 0 12px 0',
    cursor: 'pointer', position: 'relative',
  },
  editHint: {
    fontSize: '11px', color: '#555', marginLeft: '8px',
    opacity: 0.6,
  },
  heroMeta: { fontSize: '12px', color: '#555', margin: 0 },

  editRow: { display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' },
  editInput: {
    flex: 1, padding: '8px 10px', fontSize: '14px',
    backgroundColor: '#1a1a1a', color: '#fff',
    border: '1px solid #444', borderRadius: '6px', outline: 'none',
    fontFamily: 'inherit',
  },
  saveBtn: {
    padding: '8px 14px', fontSize: '12px', fontWeight: 600,
    color: '#fff', backgroundColor: '#3b82f6',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  cancelBtn: {
    padding: '8px 14px', fontSize: '12px',
    color: '#a1a1a1', backgroundColor: '#1a1a1a',
    border: '1px solid #333', borderRadius: '6px', cursor: 'pointer',
  },

  section: { marginBottom: '40px' },
  sectionHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid #1f1f1f',
  },
  sectionTitle: {
    fontSize: '18px', fontWeight: 600, margin: 0,
  },
  selectHint: {
    fontSize: '12px', color: '#8b5cf6', fontStyle: 'italic',
  },

  photoGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
  },
  photoCard: {
    position: 'relative', borderRadius: '10px', overflow: 'hidden',
    backgroundColor: '#1a1a1a', aspectRatio: '3/4',
  },
  photo: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  photoOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: '8px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  photoActions: {
    display: 'flex', gap: '4px',
  },
  photoActionBtn: {
    width: '28px', height: '28px', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: '14px', color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.15)', border: 'none',
    borderRadius: '6px', cursor: 'pointer',
  },
  photoTime: { fontSize: '10px', color: '#aaa' },
  checkbox: {
    position: 'absolute', top: '8px', left: '8px',
    width: '24px', height: '24px', borderRadius: '6px',
    border: '2px solid #8b5cf6', backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '14px', fontWeight: 700, color: '#fff', zIndex: 5,
  },
  checkboxChecked: {
    backgroundColor: '#7c3aed', borderColor: '#7c3aed',
  },
  viewAllBtn: {
    marginTop: '12px', padding: '10px 20px', fontSize: '13px',
    color: '#8b5cf6', backgroundColor: 'transparent',
    border: '1px solid #8b5cf6', borderRadius: '8px',
    cursor: 'pointer', width: '100%',
  },

  emptyConversations: {
    padding: '24px', backgroundColor: '#141414',
    borderRadius: '10px', border: '1px solid #1f1f1f',
  },
  conversationList: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  conversationCard: {
    padding: '16px', backgroundColor: '#141414',
    borderRadius: '10px', border: '1px solid #262626',
  },
  convHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '4px', flexWrap: 'wrap' as const, gap: '8px',
  },
  convTitle: { fontSize: '14px', fontWeight: 600, margin: 0 },
  convPeople: {
    fontSize: '11px', color: '#888', padding: '2px 8px',
    backgroundColor: '#1a1a1a', borderRadius: '4px',
  },
  convDate: { fontSize: '11px', color: '#555', margin: '0 0 4px 0' },
  noAudio: {
    fontSize: '12px', color: '#444', margin: '8px 0 0 0',
    fontStyle: 'italic',
  },
};
