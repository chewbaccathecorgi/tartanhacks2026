'use client';

import { useEffect, useRef, useState } from 'react';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState('Not started');
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);

  const startCamera = async () => {
    try {
      setStatus('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
      });

      // Set content hint for high quality (prioritize detail over motion)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.contentHint = 'detail';
        const settings = videoTrack.getSettings();
        console.log(`[Camera] Resolution: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setCameraStarted(true);
      setStatus('Camera ready - connecting to server...');
      
      // Auto-connect to signaling server (same origin!)
      connectToServer();
    } catch (error) {
      console.error('[Camera] Failed to access camera:', error);
      setStatus('Camera access denied');
      alert('Camera access denied. Please enable camera permissions and reload.');
    }
  };

  const connectToServer = () => {
    // Use same origin - no need to enter URL!
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/api/signaling`;

    console.log('[Camera] Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[Camera] WebSocket connected');
      setStatus('Connected to server');
      ws.send(JSON.stringify({ type: 'register', role: 'streamer' }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Camera] Received:', data.type);

        switch (data.type) {
          case 'registered':
            setStatus('Waiting for viewer to connect...');
            break;

          case 'viewer-ready':
            setStatus('Viewer connected - starting stream...');
            startStreaming();
            break;

          case 'answer':
            if (pcRef.current) {
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription(data.answer)
              );
              console.log('[Camera] Set remote description');
            }
            break;

          case 'candidate':
            if (pcRef.current && data.candidate) {
              await pcRef.current.addIceCandidate(
                new RTCIceCandidate(data.candidate)
              );
            }
            break;

          case 'error':
            setStatus('Error: ' + data.message);
            break;
        }
      } catch (error) {
        console.error('[Camera] Message error:', error);
      }
    };

    ws.onerror = () => {
      console.error('[Camera] WebSocket error');
      setStatus('Connection error');
    };

    ws.onclose = () => {
      console.log('[Camera] WebSocket closed');
      setStatus('Disconnected from server');
      setIsStreaming(false);
    };
  };

  const startStreaming = async () => {
    if (!streamRef.current) {
      setStatus('No camera stream available');
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    // Add tracks and configure HD quality settings
    for (const track of streamRef.current.getTracks()) {
      const sender = pc.addTrack(track, streamRef.current);
      console.log('[Camera] Added track:', track.kind);
      
      // Configure HD encoding settings for video tracks
      if (track.kind === 'video') {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          
          // HD Mode settings - prevent quality degradation
          params.encodings[0].maxBitrate = 10_000_000; // 10 Mbps
          params.encodings[0].scaleResolutionDownBy = 1.0; // Never scale down
          // @ts-expect-error - degradationPreference not in all TS definitions
          params.encodings[0].degradationPreference = 'maintain-resolution';
          
          await sender.setParameters(params);
          console.log('[Camera] HD encoding configured: 10 Mbps, no downscaling');
        } catch (e) {
          console.warn('[Camera] Could not set HD encoding:', e);
        }
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[Camera] Connection state:', state);

      if (state === 'connected') {
        setStatus('Streaming HD to viewer');
        setIsStreaming(true);
      } else if (state === 'connecting') {
        setStatus('Connecting...');
      } else if (state === 'failed' || state === 'disconnected') {
        setStatus('Connection ' + state);
        setIsStreaming(false);
      }
    };

    // Create and send offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          offer: pc.localDescription,
        }));
        console.log('[Camera] Sent HD offer');
      }
    } catch (error) {
      console.error('[Camera] Failed to create offer:', error);
      setStatus('Failed to create offer');
    }
  };

  const stopStreaming = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraStarted(false);
    setIsStreaming(false);
    setStatus('Stopped');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>📷 Camera Source</h1>
        <div style={styles.statusBadge}>
          <div
            style={{
              ...styles.indicator,
              backgroundColor: isStreaming
                ? '#00ff00'
                : cameraStarted
                ? '#ffa500'
                : '#ff0000',
            }}
          />
          <span>{status}</span>
        </div>
      </div>

      <div style={styles.videoContainer}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={styles.video}
        />
      </div>

      <div style={styles.controls}>
        {!cameraStarted ? (
          <button onClick={startCamera} style={styles.btnPrimary}>
            Start Camera & Stream
          </button>
        ) : (
          <button onClick={stopStreaming} style={styles.btnDanger}>
            Stop Streaming
          </button>
        )}
      </div>

      <div style={styles.instructions}>
        <p>📱 This is the camera source page</p>
        <p>📷 Grant camera permissions when prompted</p>
        <p>💻 View the stream at the main page on your laptop</p>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#000',
    color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    padding: '20px',
    backgroundColor: '#111',
    borderBottom: '1px solid #333',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '10px',
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: '#222',
    borderRadius: '20px',
  },
  indicator: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
  },
  videoContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  video: {
    width: '100%',
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '10px',
    backgroundColor: '#111',
  },
  controls: {
    padding: '20px',
    backgroundColor: '#111',
  },
  btnPrimary: {
    width: '100%',
    padding: '16px',
    fontSize: '18px',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: '10px',
    backgroundColor: '#007aff',
    color: '#fff',
    cursor: 'pointer',
  },
  btnDanger: {
    width: '100%',
    padding: '16px',
    fontSize: '18px',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: '10px',
    backgroundColor: '#ff3b30',
    color: '#fff',
    cursor: 'pointer',
  },
  instructions: {
    padding: '20px',
    textAlign: 'center',
    fontSize: '14px',
    color: '#888',
    lineHeight: 1.6,
  },
};
