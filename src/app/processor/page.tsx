'use client';

import { useEffect, useState, useCallback } from 'react';

interface FaceCompact {
  id: string;
  name: string;
  description: string;
  thumbnail: string | null;
  imageCount: number;
  capturedAt: string;
}

export default function ProcessorPage() {
  const [faces, setFaces] = useState<FaceCompact[]>([]);
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchFaces = useCallback(async () => {
    try {
      const res = await fetch('/api/faces');
      if (res.ok) {
        const data = await res.json();
        setFaces(data.faces);
      }
    } catch { /* retry next poll */ }
  }, []);

  useEffect(() => {
    fetchFaces();
    const interval = setInterval(fetchFaces, 1000);
    return () => clearInterval(interval);
  }, [fetchFaces]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const doMerge = async () => {
    if (selected.size < 2) return;
    setMerging(true);
    try {
      const res = await fetch('/api/faces/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileIds: Array.from(selected) }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Merged ${data.mergedCount} profiles into "${data.merged?.name ?? 'one'}"`);
        setMergeMode(false);
        setSelected(new Set());
        fetchFaces();
      } else {
        showToast('Merge failed');
      }
    } catch {
      showToast('Merge failed');
    }
    setMerging(false);
  };

  const cancelMerge = () => {
    setMergeMode(false);
    setSelected(new Set());
  };

  return (
    <div style={styles.container}>
      {/* Toast */}
      {toast && <div style={styles.toast}>{toast}</div>}

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h1 style={styles.title}>People</h1>
        </div>
        <div style={styles.headerRight}>
          {mergeMode ? (
            <>
              <button
                onClick={doMerge}
                disabled={selected.size < 2 || merging}
                style={{
                  ...styles.mergeBtn,
                  opacity: selected.size >= 2 && !merging ? 1 : 0.4,
                }}
              >
                {merging ? 'Merging...' : `Merge (${selected.size})`}
              </button>
              <button onClick={cancelMerge} style={styles.cancelMergeBtn}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {faces.length >= 2 && (
                <button onClick={() => setMergeMode(true)} style={styles.mergeModeBtn}>
                  Merge Profiles
                </button>
              )}
              <div style={styles.countBadge}>
                {faces.length} {faces.length === 1 ? 'person' : 'people'}
              </div>
            </>
          )}
        </div>
      </header>

      <main style={styles.main}>
        {mergeMode && (
          <div style={styles.mergeHint}>
            Select 2 or more profiles to merge into one
          </div>
        )}

        {faces.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ color: '#333', marginBottom: '24px' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </div>
            <h2 style={styles.emptyTitle}>No people captured yet</h2>
            <p style={styles.emptySubtitle}>
              On the stream page: start a stream, then either start recording (faces auto-save every 2s) or click &quot;Save faces now&quot; / show a peace sign to capture faces. They will appear here.
            </p>
          </div>
        ) : (
          <div style={styles.grid}>
            {faces.map((face) => {
              const isSelected = selected.has(face.id);
              return mergeMode ? (
                <div
                  key={face.id}
                  style={{
                    ...styles.card,
                    cursor: 'pointer',
                    ...(isSelected
                      ? { borderColor: '#8b5cf6', boxShadow: '0 0 16px rgba(139, 92, 246, 0.3)' }
                      : {}),
                  }}
                  onClick={() => toggleSelect(face.id)}
                >
                  {/* Selection indicator */}
                  <div style={{
                    ...styles.mergeCheckbox,
                    ...(isSelected ? styles.mergeCheckboxChecked : {}),
                  }}>
                    {isSelected && '✓'}
                  </div>
                  <div style={styles.cardImageWrap}>
                    {face.thumbnail ? (
                      <img
                        src={face.thumbnail}
                        alt={face.name}
                        style={styles.cardImage}
                      />
                    ) : (
                      <div style={styles.cardPlaceholder}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="1.5">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        </svg>
                      </div>
                    )}
                    {face.imageCount > 1 && (
                      <div style={styles.imageBadge}>
                        {face.imageCount} photos
                      </div>
                    )}
                  </div>
                  <div style={styles.cardBody}>
                    <h3 style={styles.cardName}>{face.name}</h3>
                    {face.description && (
                      <p style={styles.cardDesc}>{face.description}</p>
                    )}
                    <p style={styles.cardTime}>
                      First seen {new Date(face.capturedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ) : (
                <a
                  key={face.id}
                  href={`/processor/${face.id}`}
                  style={styles.card}
                >
                  <div style={styles.cardImageWrap}>
                    {face.thumbnail ? (
                      <img
                        src={face.thumbnail}
                        alt={face.name}
                        style={styles.cardImage}
                      />
                    ) : (
                      <div style={styles.cardPlaceholder}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="1.5">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        </svg>
                      </div>
                    )}
                    {face.imageCount > 1 && (
                      <div style={styles.imageBadge}>
                        {face.imageCount} photos
                      </div>
                    )}
                  </div>
                  <div style={styles.cardBody}>
                    <h3 style={styles.cardName}>{face.name}</h3>
                    {face.description && (
                      <p style={styles.cardDesc}>{face.description}</p>
                    )}
                    <p style={styles.cardTime}>
                      First seen {new Date(face.capturedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </main>

      <footer style={styles.footer}>
        <p style={styles.footerText}>
          Face Processor • Azure Face API • Click a person to view their full profile
        </p>
      </footer>
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
    alignItems: 'center', borderBottom: '1px solid #1f1f1f', backgroundColor: '#0a0a0a',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  logo: { display: 'flex', alignItems: 'center', color: '#8b5cf6' },
  title: { fontSize: '20px', fontWeight: 600, margin: 0, letterSpacing: '-0.5px' },
  countBadge: {
    padding: '6px 14px', backgroundColor: '#1a1a1a', borderRadius: '9999px',
    border: '1px solid #262626', fontSize: '13px', color: '#a1a1a1',
  },
  mergeModeBtn: {
    padding: '6px 14px', fontSize: '12px', color: '#8b5cf6',
    backgroundColor: 'transparent', border: '1px solid #8b5cf6',
    borderRadius: '6px', cursor: 'pointer', fontWeight: 500,
  },
  mergeBtn: {
    padding: '6px 14px', fontSize: '12px', color: '#fff',
    backgroundColor: '#7c3aed', border: 'none',
    borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
  },
  cancelMergeBtn: {
    padding: '6px 14px', fontSize: '12px', color: '#a1a1a1',
    backgroundColor: 'transparent', border: '1px solid #444',
    borderRadius: '6px', cursor: 'pointer',
  },
  mergeHint: {
    textAlign: 'center', padding: '12px', marginBottom: '16px',
    backgroundColor: '#1a1a2e', color: '#8b5cf6',
    borderRadius: '8px', border: '1px solid #8b5cf633',
    fontSize: '13px',
  },
  toast: {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    padding: '10px 24px', backgroundColor: '#052e16', color: '#22c55e',
    borderRadius: '8px', border: '1px solid #22c55e', fontSize: '14px',
    fontWeight: 500, zIndex: 999,
  },
  main: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '32px 24px',
  },
  emptyState: { textAlign: 'center', padding: '80px 20px' },
  emptyTitle: { fontSize: '20px', fontWeight: 600, margin: '0 0 8px 0', color: '#666' },
  emptySubtitle: { fontSize: '14px', color: '#444', margin: 0 },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '20px', width: '100%', maxWidth: '1000px',
  },
  card: {
    backgroundColor: '#141414', borderRadius: '12px',
    border: '1px solid #262626', overflow: 'hidden',
    textDecoration: 'none', color: 'inherit',
    cursor: 'pointer', transition: 'border-color 0.2s',
    position: 'relative',
  },
  mergeCheckbox: {
    position: 'absolute', top: '10px', left: '10px', zIndex: 5,
    width: '26px', height: '26px', borderRadius: '8px',
    border: '2px solid #8b5cf6', backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '14px', fontWeight: 700, color: '#fff',
  },
  mergeCheckboxChecked: {
    backgroundColor: '#7c3aed', borderColor: '#7c3aed',
  },
  cardImageWrap: {
    position: 'relative', width: '100%', aspectRatio: '1/1',
    overflow: 'hidden', backgroundColor: '#1a1a1a',
  },
  cardImage: { width: '100%', height: '100%', objectFit: 'cover' },
  cardPlaceholder: {
    width: '100%', height: '100%', display: 'flex',
    alignItems: 'center', justifyContent: 'center', color: '#333',
  },
  imageBadge: {
    position: 'absolute', bottom: '8px', right: '8px',
    padding: '4px 8px', backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: '6px', fontSize: '11px', color: '#ccc',
  },
  cardBody: { padding: '14px' },
  cardName: { fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0' },
  cardDesc: {
    fontSize: '12px', color: '#888', margin: '0 0 6px 0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  cardTime: { fontSize: '11px', color: '#555', margin: 0 },
  footer: { padding: '16px 24px', borderTop: '1px solid #1f1f1f', textAlign: 'center' },
  footerText: { fontSize: '12px', color: '#525252', margin: 0 },
};
