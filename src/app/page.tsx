'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FaceLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ─── Types ─────────────────────────────────────────────────────────
type InboundMessage =
  | { type: 'registered'; role: 'viewer'; streamerReady?: boolean }
  | { type: 'streamer-ready' }
  | { type: 'streamer-disconnected' }
  | { type: 'processor-ready' }
  | { type: 'processor-disconnected' }
  | { type: 'offer'; offer: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'face-result'; faceId: number; results: unknown; timestamp: number }
  | { type: 'error'; message: string };

interface DetectedFace {
  x: number;      // normalized 0-1
  y: number;
  width: number;
  height: number;
}

interface SmoothedFace extends DetectedFace {
  id: number;
  age: number;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

// ─── Smoothing / Tracking ───────────────────────────────────────────
const SMOOTHING = 0.4;          // Lerp factor per frame (higher = snappier)
const MAX_MATCH_DIST = 0.12;    // Max center-distance to match same face
const MAX_AGE = 4;              // Keep ghost for N frames after lost

let nextFaceId = 0;
let trackedFaces: SmoothedFace[] = [];

function matchAndSmooth(rawFaces: DetectedFace[]): SmoothedFace[] {
  const used = new Set<number>();
  const updated: SmoothedFace[] = [];

  for (const tracked of trackedFaces) {
    let bestIdx = -1;
    let bestDist = Infinity;
    const cx1 = tracked.x + tracked.width / 2;
    const cy1 = tracked.y + tracked.height / 2;

    for (let i = 0; i < rawFaces.length; i++) {
      if (used.has(i)) continue;
      const r = rawFaces[i];
      const dist = Math.hypot(cx1 - (r.x + r.width / 2), cy1 - (r.y + r.height / 2));
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    if (bestIdx >= 0 && bestDist < MAX_MATCH_DIST) {
      used.add(bestIdx);
      const r = rawFaces[bestIdx];
      updated.push({
        id: tracked.id,
        x:      tracked.x      + (r.x      - tracked.x)      * SMOOTHING,
        y:      tracked.y      + (r.y      - tracked.y)      * SMOOTHING,
        width:  tracked.width  + (r.width  - tracked.width)  * SMOOTHING,
        height: tracked.height + (r.height - tracked.height) * SMOOTHING,
        age: 0,
      });
    } else if (tracked.age < MAX_AGE) {
      updated.push({ ...tracked, age: tracked.age + 1 });
    }
  }

  for (let i = 0; i < rawFaces.length; i++) {
    if (!used.has(i)) {
      updated.push({ ...rawFaces[i], id: nextFaceId++, age: 0 });
    }
  }

  trackedFaces = updated;
  return updated;
}

// ─── Bounding box from 478 landmarks ────────────────────────────────
// Landmarks are normalized 0-1 already. We compute the tight bounding
// box from all landmark positions, then add a small margin so the box
// neatly frames the head rather than clipping at the jawline / hairline.
function landmarksToBBox(landmarks: { x: number; y: number }[]): DetectedFace {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;

  // Small margin: 12% horizontal, 18% above (forehead), 8% below (chin)
  const mx = w * 0.12;
  const mtop = h * 0.18;
  const mbot = h * 0.08;

  return {
    x:      minX - mx,
    y:      minY - mtop,
    width:  w + mx * 2,
    height: h + mtop + mbot,
  };
}

// ─── Face Landmarker Setup ──────────────────────────────────────────
async function initFaceLandmarker(): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 6,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  console.log('[FaceLandmarker] Initialized (478 landmarks, up to 6 faces)');
  return landmarker;
}

// ─── Hand Landmarker Setup ──────────────────────────────────────────
async function initHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  console.log('[HandLandmarker] Initialized (21 landmarks, up to 2 hands)');
  return handLandmarker;
}

// ─── Peace Sign Detection ───────────────────────────────────────────
// MediaPipe hand landmarks:
//   0 = wrist
//   4 = thumb tip,    3 = thumb IP,    2 = thumb MCP
//   8 = index tip,    6 = index PIP,   5 = index MCP
//  12 = middle tip,  10 = middle PIP,  9 = middle MCP
//  16 = ring tip,    14 = ring PIP,   13 = ring MCP
//  20 = pinky tip,   18 = pinky PIP,  17 = pinky MCP
//
// A finger is "extended" if its tip is farther from the wrist than its PIP joint.
// Peace sign = index + middle extended, ring + pinky curled.
function isPeaceSign(landmarks: { x: number; y: number; z: number }[]): boolean {
  if (landmarks.length < 21) return false;

  // Use y-coordinate: lower y = higher on screen (finger pointing up)
  const indexExtended  = landmarks[8].y  < landmarks[6].y;
  const middleExtended = landmarks[12].y < landmarks[10].y;
  const ringCurled     = landmarks[16].y > landmarks[14].y;
  const pinkyCurled    = landmarks[20].y > landmarks[18].y;

  return indexExtended && middleExtended && ringCurled && pinkyCurled;
}

// Cooldown to prevent spamming (ms)
const GESTURE_COOLDOWN_MS = 2000;
let lastGestureTime = 0;

// ─── Video display area (handles object-fit: contain) ───────────────
// The video element uses object-fit:contain, so with a portrait phone
// stream in a landscape container there are black bars on the sides.
// We must map normalized landmark coords → the actual visible region.
interface DisplayArea {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

function getVideoDisplayArea(
  video: HTMLVideoElement,
  containerW: number,
  containerH: number
): DisplayArea {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const videoAspect = vw / vh;
  const containerAspect = containerW / containerH;

  let drawW: number, drawH: number, offsetX: number, offsetY: number;

  if (videoAspect > containerAspect) {
    // Video wider than container → black bars top/bottom
    drawW = containerW;
    drawH = containerW / videoAspect;
    offsetX = 0;
    offsetY = (containerH - drawH) / 2;
  } else {
    // Video taller than container → black bars left/right (portrait phone)
    drawH = containerH;
    drawW = containerH * videoAspect;
    offsetX = (containerW - drawW) / 2;
    offsetY = 0;
  }

  return { offsetX, offsetY, drawW, drawH };
}

// ─── Drawing ────────────────────────────────────────────────────────
function drawBoundingBoxes(
  ctx: CanvasRenderingContext2D,
  faces: SmoothedFace[],
  cw: number,
  ch: number,
  area: DisplayArea
) {
  ctx.clearRect(0, 0, cw, ch);

  for (const f of faces) {
    // Map normalized face coords into the actual video display region
    const x = area.offsetX + f.x * area.drawW;
    const y = area.offsetY + f.y * area.drawH;
    const w = f.width * area.drawW;
    const h = f.height * area.drawH;
    const r = 8;
    const alpha = f.age === 0 ? 1 : Math.max(0.25, 1 - f.age * 0.2);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Box stroke
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();

    // Very subtle tinted fill
    ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    ctx.restore();
  }
}

// ─── Crop Face from Video ───────────────────────────────────────────
// Given a video element and a normalized bounding box, crop the face
// region to a base64 JPEG string.
function cropFaceFromVideo(
  video: HTMLVideoElement,
  face: DetectedFace,
  quality = 0.92
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  // Convert normalized coords to pixel coords on the raw video
  const sx = Math.max(0, Math.floor(face.x * vw));
  const sy = Math.max(0, Math.floor(face.y * vh));
  const sw = Math.min(Math.floor(face.width * vw), vw - sx);
  const sh = Math.min(Math.floor(face.height * vh), vh - sy);

  if (sw <= 0 || sh <= 0) return null;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const ctx = cropCanvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return cropCanvas.toDataURL('image/jpeg', quality);
}

// ─── Component ─────────────────────────────────────────────────────
export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceLandmarker | null>(null);
  const handDetectorRef = useRef<HandLandmarker | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastDetectTimeRef = useRef<number>(0);
  const latestFacesRef = useRef<SmoothedFace[]>([]);

  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState('Not connected');
  const [faceCount, setFaceCount] = useState(0);
  const [detectionEnabled, setDetectionEnabled] = useState(true);
  const [gestureDetected, setGestureDetected] = useState(false);
  const [processorConnected, setProcessorConnected] = useState(false);
  const [lastSentFace, setLastSentFace] = useState<string | null>(null);

  // ─── Face Detection Loop ──────────────────────────────────────
  const runDetection = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;

    if (!video || !canvas || !detector || video.paused || video.ended) {
      animFrameRef.current = requestAnimationFrame(runDetection);
      return;
    }

    // Match canvas size to video display size
    const rect = video.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      animFrameRef.current = requestAnimationFrame(runDetection);
      return;
    }

    // Only detect if video has data and enough time has passed
    const now = performance.now();
    if (video.readyState >= 2 && now - lastDetectTimeRef.current > 33) {
      // ~30fps detection
      lastDetectTimeRef.current = now;

      try {
        const result = detector.detectForVideo(video, now);
        // Build bounding boxes from the 478 landmarks per face
        const rawFaces: DetectedFace[] = (result.faceLandmarks || []).map(
          (landmarks) => landmarksToBBox(landmarks)
        );

        const smoothed = matchAndSmooth(rawFaces);
        latestFacesRef.current = smoothed;
        const activeFaces = smoothed.filter((f) => f.age === 0);
        setFaceCount(activeFaces.length);

        // Compute actual video display area (accounts for object-fit:contain)
        const area = getVideoDisplayArea(video, canvas.width, canvas.height);
        drawBoundingBoxes(ctx, smoothed, canvas.width, canvas.height, area);
      } catch {
        // Detection might fail on some frames; just skip
      }

      // ─── Hand Gesture Detection ───────────────────────────────
      const handDetector = handDetectorRef.current;
      if (handDetector) {
        try {
          const handResult = handDetector.detectForVideo(video, now);
          if (handResult.landmarks && handResult.landmarks.length > 0) {
            for (const handLandmarks of handResult.landmarks) {
              if (isPeaceSign(handLandmarks)) {
                const timeSinceLastGesture = now - lastGestureTime;
                if (timeSinceLastGesture > GESTURE_COOLDOWN_MS) {
                  lastGestureTime = now;
                  console.log('[Gesture] ✌️ PEACE SIGN DETECTED!');
                  setGestureDetected(true);
                  setTimeout(() => setGestureDetected(false), 1000);

                  // ─── Crop best face & send to processor ───────
                  const currentFaces = latestFacesRef.current.filter((f) => f.age === 0);
                  if (currentFaces.length > 0 && video) {
                    // Pick the largest face (biggest bounding box area = most prominent)
                    const bestFace = currentFaces.reduce((best, f) =>
                      f.width * f.height > best.width * best.height ? f : best
                    );

                    const faceImage = cropFaceFromVideo(video, bestFace);
                    if (faceImage) {
                      console.log(`[Gesture] Cropped face #${bestFace.id} (${Math.round(faceImage.length / 1024)}KB)`);
                      setLastSentFace(faceImage);

                      // Send via WebSocket to processor
                      const ws = wsRef.current;
                      if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                          type: 'face-image',
                          image: faceImage,
                          faceId: bestFace.id,
                          timestamp: Date.now(),
                        }));
                        console.log(`[Gesture] Sent face #${bestFace.id} to processor`);
                      } else {
                        console.warn('[Gesture] WebSocket not connected, cannot send face');
                      }
                    }
                  } else {
                    console.log('[Gesture] Peace sign detected but no active faces to send');
                  }
                }
              }
            }
          }
        } catch {
          // Hand detection might fail on some frames; just skip
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(runDetection);
  }, []);

  // ─── Initialize Face Detector ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    initFaceLandmarker().then((lm) => {
      if (!cancelled) {
        detectorRef.current = lm;
        console.log('[FaceLandmarker] Ready');
      }
    }).catch((err) => {
      console.error('[FaceLandmarker] Init failed:', err);
    });

    initHandLandmarker().then((hl) => {
      if (!cancelled) {
        handDetectorRef.current = hl;
        console.log('[HandLandmarker] Ready');
      }
    }).catch((err) => {
      console.error('[HandLandmarker] Init failed:', err);
    });

    return () => {
      cancelled = true;
      if (detectorRef.current) {
        detectorRef.current.close();
        detectorRef.current = null;
      }
      if (handDetectorRef.current) {
        handDetectorRef.current.close();
        handDetectorRef.current = null;
      }
    };
  }, []);

  // ─── Start/Stop Detection Loop ────────────────────────────────
  useEffect(() => {
    if (isStreaming && detectionEnabled) {
      animFrameRef.current = requestAnimationFrame(runDetection);
    } else {
      cancelAnimationFrame(animFrameRef.current);
      // Clear canvas when detection stops
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      setFaceCount(0);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isStreaming, detectionEnabled, runDetection]);

  // ─── Attach Stream to Video ───────────────────────────────────
  useEffect(() => {
    if (isStreaming && videoRef.current && streamRef.current) {
      console.log('[Viewer] Attaching stream to video element');
      const video = videoRef.current;
      video.srcObject = streamRef.current;
      video.play().catch((e) => {
        console.warn('[Viewer] Autoplay failed, user interaction needed:', e);
      });
    }
  }, [isStreaming]);

  // ─── WebRTC Connection ────────────────────────────────────────
  useEffect(() => {
    let isCancelled = false;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const createPeerConnection = (ws: WebSocket) => {
      if (pcRef.current) {
        pcRef.current.close();
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'candidate',
              candidate: event.candidate.toJSON(),
            })
          );
        }
      };

      pc.ontrack = (event) => {
        console.log('[Viewer] Received remote track:', event.track.kind);
        const stream = event.streams[0];
        streamRef.current = stream;

        if (videoRef.current) {
          console.log('[Viewer] Attaching stream immediately');
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((e) => {
            console.warn('[Viewer] Autoplay blocked:', e);
          });
        }

        setIsStreaming(true);
        setStatus('Live');
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('[Viewer] WebRTC connection state:', state);
        if (state === 'connected') {
          setStatus('Live');
        } else if (state === 'failed') {
          setStatus('Connection failed');
          setIsStreaming(false);
        } else if (state === 'disconnected') {
          setStatus('Disconnected');
          setIsStreaming(false);
        }
      };

      return pc;
    };

    const handleOffer = async (
      ws: WebSocket,
      offer: RTCSessionDescriptionInit
    ) => {
      try {
        const pc = createPeerConnection(ws);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'answer', answer }));
        }
        setStatus('Connecting...');
      } catch (error) {
        console.error('[Viewer] Failed to handle offer:', error);
        setStatus('Failed to connect');
      }
    };

    const connect = async () => {
      if (isCancelled) return;

      try {
        await fetch('/api/health').catch(() => {});
      } catch {
        // Ignore warmup errors
      }

      if (isCancelled) return;

      const protocol =
        window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}/api/signaling`;

      setStatus('Connecting...');
      console.log('[Viewer] Connecting to:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isCancelled) {
          ws.close();
          return;
        }
        console.log('[Viewer] WebSocket connected');
        setIsConnected(true);
        setStatus('Waiting for camera...');
        ws.send(JSON.stringify({ type: 'register', role: 'viewer' }));
      };

      ws.onmessage = async (event) => {
        if (isCancelled) return;

        try {
          const payload: InboundMessage = JSON.parse(event.data);
          console.log('[Viewer] Received message:', payload.type);

          switch (payload.type) {
            case 'registered':
              setStatus(
                payload.streamerReady
                  ? 'Camera found, connecting...'
                  : 'Waiting for camera...'
              );
              break;

            case 'streamer-ready':
              setStatus('Camera connected');
              break;

            case 'streamer-disconnected':
              setStatus('Camera disconnected');
              setIsStreaming(false);
              if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
              }
              break;

            case 'offer':
              await handleOffer(ws, payload.offer);
              break;

            case 'candidate':
              if (pcRef.current && payload.candidate) {
                try {
                  await pcRef.current.addIceCandidate(
                    new RTCIceCandidate(payload.candidate)
                  );
                } catch (e) {
                  console.warn('[Viewer] Failed to add ICE candidate:', e);
                }
              }
              break;

            case 'processor-ready':
              setProcessorConnected(true);
              console.log('[Viewer] Processor connected');
              break;

            case 'processor-disconnected':
              setProcessorConnected(false);
              console.log('[Viewer] Processor disconnected');
              break;

            case 'face-result':
              console.log('[Viewer] Received face result:', payload);
              // TODO: Display results on the UI next to the bounding box
              break;

            case 'error':
              setStatus(`Error: ${payload.message}`);
              break;
          }
        } catch (error) {
          console.error('[Viewer] Failed to handle message:', error);
        }
      };

      ws.onerror = (event) => {
        console.error('[Viewer] WebSocket error:', event);
        setStatus('Connection error');
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('[Viewer] WebSocket closed, isCancelled:', isCancelled);
        if (!isCancelled) {
          setStatus('Reconnecting...');
          setIsConnected(false);
          setIsStreaming(false);
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };
    };

    void connect();

    return () => {
      console.log('[Viewer] Cleanup running');
      isCancelled = true;

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      wsRef.current = null;

      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, []);

  // ─── Helpers ──────────────────────────────────────────────────
  const getStatusColor = () => {
    if (isStreaming) return '#10b981';
    if (isConnected) return '#f59e0b';
    return '#ef4444';
  };

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <h1 style={styles.title}>FaceStream</h1>
        </div>

        <div style={styles.statusBadge}>
          <div
            style={{ ...styles.statusDot, backgroundColor: getStatusColor() }}
          />
          <span style={styles.statusText}>{status}</span>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        <div style={styles.videoWrapper}>
          {/* Video element */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              ...styles.video,
              opacity: isStreaming ? 1 : 0,
              position: isStreaming ? 'relative' : 'absolute',
            }}
          />

          {/* Face detection overlay canvas */}
          {isStreaming && (
            <canvas
              ref={canvasRef}
              style={styles.canvas}
            />
          )}

          {/* Placeholder when not streaming */}
          {!isStreaming && (
            <div style={styles.placeholder}>
              <div style={styles.placeholderInner}>
                <div style={styles.pulseContainer}>
                  <div style={styles.pulseRing} />
                  <div style={styles.pulseRingDelayed} />
                  <div style={styles.cameraIcon}>
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                </div>

                <h2 style={styles.placeholderTitle}>
                  {isConnected ? 'Waiting for Camera' : 'Connecting...'}
                </h2>
                <p style={styles.placeholderSubtitle}>
                  Open <code style={styles.code}>/camera</code> on your phone to
                  start streaming
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Info Cards */}
        <div style={styles.infoRow}>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>📱</div>
            <div>
              <div style={styles.infoLabel}>Camera Source</div>
              <div style={styles.infoValue}>
                {isStreaming ? 'Connected' : 'Not connected'}
              </div>
            </div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🧑</div>
            <div>
              <div style={styles.infoLabel}>Faces Detected</div>
              <div style={styles.infoValue}>
                {isStreaming ? faceCount : '--'}
              </div>
            </div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🔍</div>
            <div>
              <div style={styles.infoLabel}>Detection</div>
              <div
                style={{
                  ...styles.infoValue,
                  cursor: 'pointer',
                  color: detectionEnabled ? '#10b981' : '#ef4444',
                }}
                onClick={() => setDetectionEnabled(!detectionEnabled)}
              >
                {detectionEnabled ? 'Active' : 'Paused'}{' '}
                <span style={{ fontSize: '11px', color: '#666' }}>
                  (click)
                </span>
              </div>
            </div>
          </div>
          <div style={{
            ...styles.infoCard,
            borderColor: gestureDetected ? '#10b981' : '#262626',
            transition: 'border-color 0.3s ease',
          }}>
            <div style={styles.infoIcon}>✌️</div>
            <div>
              <div style={styles.infoLabel}>Gesture</div>
              <div style={{
                ...styles.infoValue,
                color: gestureDetected ? '#10b981' : '#a1a1a1',
                transition: 'color 0.3s ease',
              }}>
                {gestureDetected ? 'Peace Sign!' : 'Waiting...'}
              </div>
            </div>
          </div>
          <div style={{
            ...styles.infoCard,
            borderColor: processorConnected ? '#10b981' : '#262626',
          }}>
            <div style={styles.infoIcon}>💻</div>
            <div>
              <div style={styles.infoLabel}>Processor</div>
              <div style={{
                ...styles.infoValue,
                color: processorConnected ? '#10b981' : '#a1a1a1',
              }}>
                {processorConnected ? 'Connected' : 'Not connected'}
              </div>
            </div>
          </div>
        </div>

        {/* Last Sent Face Preview */}
        {lastSentFace && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px 20px',
            backgroundColor: '#141414',
            borderRadius: '12px',
            border: '1px solid #262626',
            maxWidth: '800px',
            width: '100%',
          }}>
            <img
              src={lastSentFace}
              alt="Last sent face"
              style={{
                width: '64px',
                height: '64px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: '1px solid #333',
              }}
            />
            <div>
              <div style={{ fontSize: '13px', color: '#a1a1a1', marginBottom: '4px' }}>
                Last Captured Face
              </div>
              <div style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>
                {processorConnected ? 'Sent to processor' : 'Waiting for processor...'}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <p style={styles.footerText}>
          Facial Recognition Stream • MediaPipe Face Landmarker (478 landmarks)
        </p>
      </footer>

      {/* CSS for animations */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
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
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },

  // Header
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
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#3b82f6',
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

  // Main
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 24px',
    gap: '24px',
  },
  videoWrapper: {
    position: 'relative',
    width: '100%',
    maxWidth: '800px',
    aspectRatio: '16/9',
    backgroundColor: '#141414',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    border: '1px solid #262626',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    backgroundColor: '#000',
  },
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  placeholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#141414',
  },
  placeholderInner: {
    textAlign: 'center',
    padding: '40px',
  },
  pulseContainer: {
    position: 'relative',
    width: '120px',
    height: '120px',
    margin: '0 auto 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    border: '2px solid #3b82f6',
    animation: 'pulse 2s ease-out infinite',
  },
  pulseRingDelayed: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    border: '2px solid #3b82f6',
    animation: 'pulse 2s ease-out infinite',
    animationDelay: '1s',
  },
  cameraIcon: {
    color: '#3b82f6',
    opacity: 0.8,
  },
  placeholderTitle: {
    fontSize: '20px',
    fontWeight: 600,
    margin: '0 0 8px 0',
    color: '#fff',
  },
  placeholderSubtitle: {
    fontSize: '14px',
    color: '#666',
    margin: 0,
  },
  code: {
    backgroundColor: '#262626',
    padding: '2px 8px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '13px',
    color: '#3b82f6',
  },

  // Info Cards
  infoRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '100%',
    maxWidth: '800px',
  },
  infoCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px 20px',
    backgroundColor: '#141414',
    borderRadius: '12px',
    border: '1px solid #262626',
    minWidth: '180px',
  },
  infoIcon: {
    fontSize: '24px',
  },
  infoLabel: {
    fontSize: '12px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '2px',
  },
  infoValue: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#fff',
  },

  // Footer
  footer: {
    padding: '16px 24px',
    borderTop: '1px solid #1f1f1f',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '12px',
    color: '#525252',
    margin: 0,
  },
};
