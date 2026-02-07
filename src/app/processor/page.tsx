'use client';

import { useEffect, useRef, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────
interface FaceImage {
  image: string;      // base64 JPEG
  faceId: number;
  timestamp: number;
}

type InboundMessage =
  | { type: 'registered'; role: 'processor' }
  | { type: 'face-image'; image: string; faceId: number; timestamp: number }
  | { type: 'error'; message: string };

// ─── Component ─────────────────────────────────────────────────────
export default function ProcessorPage() {
  const wsRef = useRef<WebSocket | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [faceImages, setFaceImages] = useState<FaceImage[]>([]);
  const [status, setStatus] = useState('Connecting...');

  useEffect(() => {
    let isCancelled = false;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      if (isCancelled) return;

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}/api/signaling`;

      console.log('[Processor] Connecting to:', wsUrl);
      setStatus('Connecting...');

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isCancelled) { ws.close(); return; }
        console.log('[Processor] WebSocket connected');
        setIsConnected(true);
        setStatus('Connected - waiting for face images...');
        ws.send(JSON.stringify({ type: 'register', role: 'processor' }));
      };

      ws.onmessage = (event) => {
        if (isCancelled) return;

        try {
          const payload: InboundMessage = JSON.parse(event.data);

          switch (payload.type) {
            case 'registered':
              console.log('[Processor] Registered successfully');
              setStatus('Ready - waiting for face captures...');
              break;

            case 'face-image': {
              console.log(`[Processor] Received face #${payload.faceId} (${Math.round(payload.image.length / 1024)}KB)`);
              const newFace: FaceImage = {
                image: payload.image,
                faceId: payload.faceId,
                timestamp: payload.timestamp,
              };
              // Add to front of list, keep last 20
              setFaceImages((prev) => [newFace, ...prev].slice(0, 20));
              setStatus(`Received face #${payload.faceId}`);
              break;
            }

            case 'error':
              console.error('[Processor] Error:', payload.message);
              setStatus(`Error: ${payload.message}`);
              break;
          }
        } catch (error) {
          console.error('[Processor] Failed to parse message:', error);
        }
      };

      ws.onerror = (event) => {
        console.error('[Processor] WebSocket error:', event);
        setStatus('Connection error');
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('[Processor] WebSocket closed');
        if (!isCancelled) {
          setStatus('Reconnecting...');
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      isCancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      wsRef.current = null;
    };
  }, []);

  // ─── Download helper ─────────────────────────────────────────────
  const downloadFace = (face: FaceImage) => {
    const link = document.createElement('a');
    link.href = face.image;
    link.download = `face_${face.faceId}_${face.timestamp}.jpg`;
    link.click();
  };

  // ─── Send results back to viewer ─────────────────────────────────
  const sendResult = (faceId: number, resultText: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'face-result',
        faceId,
        results: { text: resultText },
        timestamp: Date.now(),
      }));
      console.log(`[Processor] Sent result for face #${faceId}`);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={{ color: '#8b5cf6', display: 'flex', alignItems: 'center' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
          </div>
          <h1 style={styles.title}>Face Processor</h1>
        </div>

        <div style={styles.statusBadge}>
          <div style={{
            ...styles.statusDot,
            backgroundColor: isConnected ? '#10b981' : '#ef4444',
          }} />
          <span style={styles.statusText}>{status}</span>
        </div>
      </header>

      {/* Main */}
      <main style={styles.main}>
        {/* Instructions */}
        <div style={styles.instructions}>
          <h2 style={{ margin: '0 0 8px', fontSize: '16px', color: '#fff' }}>How to use</h2>
          <ol style={{ margin: 0, paddingLeft: '20px', color: '#a1a1a1', fontSize: '14px', lineHeight: 1.8 }}>
            <li>Keep this page open - it auto-connects to the viewer</li>
            <li>When a peace sign is shown on camera, the best face is sent here</li>
            <li>Click <strong>Download</strong> to save the face image for PimEyes upload</li>
            <li>After getting results, paste info and click <strong>Send Back</strong></li>
          </ol>
        </div>

        {/* Face images grid */}
        {faceImages.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✌️</div>
            <p style={{ color: '#666', fontSize: '16px', margin: 0 }}>
              No face images received yet.
            </p>
            <p style={{ color: '#525252', fontSize: '14px', margin: '8px 0 0' }}>
              Show a peace sign on the camera stream to capture a face.
            </p>
          </div>
        ) : (
          <div style={styles.grid}>
            {faceImages.map((face, i) => (
              <FaceCard
                key={`${face.faceId}-${face.timestamp}`}
                face={face}
                isLatest={i === 0}
                onDownload={() => downloadFace(face)}
                onSendResult={(text) => sendResult(face.faceId, text)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Face Card Component ────────────────────────────────────────────
function FaceCard({
  face,
  isLatest,
  onDownload,
  onSendResult,
}: {
  face: FaceImage;
  isLatest: boolean;
  onDownload: () => void;
  onSendResult: (text: string) => void;
}) {
  const [resultText, setResultText] = useState('');
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (resultText.trim()) {
      onSendResult(resultText);
      setSent(true);
    }
  };

  return (
    <div style={{
      ...styles.card,
      borderColor: isLatest ? '#8b5cf6' : '#262626',
    }}>
      {isLatest && (
        <div style={styles.latestBadge}>LATEST</div>
      )}

      <img
        src={face.image}
        alt={`Face #${face.faceId}`}
        style={styles.faceImg}
      />

      <div style={styles.cardInfo}>
        <div style={{ fontSize: '13px', color: '#a1a1a1' }}>
          Face #{face.faceId}
        </div>
        <div style={{ fontSize: '12px', color: '#525252' }}>
          {new Date(face.timestamp).toLocaleTimeString()}
        </div>
      </div>

      <div style={styles.cardActions}>
        <button onClick={onDownload} style={styles.btnPrimary}>
          Download
        </button>
      </div>

      {/* Result input */}
      <div style={styles.resultSection}>
        <textarea
          value={resultText}
          onChange={(e) => setResultText(e.target.value)}
          placeholder="Paste PimEyes results or info here..."
          style={styles.textarea}
          rows={3}
        />
        <button
          onClick={handleSend}
          disabled={sent || !resultText.trim()}
          style={{
            ...styles.btnSend,
            opacity: sent || !resultText.trim() ? 0.5 : 1,
          }}
        >
          {sent ? 'Sent!' : 'Send Back'}
        </button>
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────
const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0a0a0a',
    color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #1f1f1f',
    backgroundColor: '#0a0a0a',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    margin: 0,
    letterSpacing: '-0.5px',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: '#1a1a1a',
    borderRadius: '9999px',
    border: '1px solid #262626',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  statusText: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#a1a1a1',
  },
  main: {
    flex: 1,
    padding: '32px 24px',
    maxWidth: '1000px',
    margin: '0 auto',
    width: '100%',
  },
  instructions: {
    padding: '20px',
    backgroundColor: '#141414',
    borderRadius: '12px',
    border: '1px solid #262626',
    marginBottom: '24px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '80px 20px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
  },
  card: {
    position: 'relative',
    backgroundColor: '#141414',
    borderRadius: '12px',
    border: '1px solid #262626',
    overflow: 'hidden',
    transition: 'border-color 0.3s ease',
  },
  latestBadge: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    padding: '4px 8px',
    backgroundColor: '#8b5cf6',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 700,
    borderRadius: '4px',
    letterSpacing: '0.5px',
    zIndex: 1,
  },
  faceImg: {
    width: '100%',
    aspectRatio: '1',
    objectFit: 'cover',
    backgroundColor: '#000',
  },
  cardInfo: {
    padding: '12px 16px 8px',
  },
  cardActions: {
    padding: '0 16px 12px',
    display: 'flex',
    gap: '8px',
  },
  btnPrimary: {
    flex: 1,
    padding: '8px 16px',
    backgroundColor: '#8b5cf6',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  resultSection: {
    padding: '0 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#0a0a0a',
    color: '#fff',
    border: '1px solid #333',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  btnSend: {
    padding: '8px 16px',
    backgroundColor: '#10b981',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
