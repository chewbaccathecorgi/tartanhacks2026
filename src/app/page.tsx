'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  FaceLandmarker,
  GestureRecognizer,
  FilesetResolver,
} from '@mediapipe/tasks-vision';

// ─── Types ─────────────────────────────────────────────────────────
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

// ─── Suppress TF Lite / XNNPACK noise ──────────────────────────────
const TF_NOISE = /TensorFlow Lite|XNNPACK/;

function patchConsoleForTFLite() {
  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;
  const guard = (orig: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (args.length > 0 && TF_NOISE.test(String(args[0]))) return;
      orig.apply(console, args);
    };
  console.log = guard(origLog);
  console.info = guard(origInfo);
  console.warn = guard(origWarn);
  console.error = guard(origError);
}

if (typeof window !== 'undefined') patchConsoleForTFLite();

// ─── Smoothing / Tracking ───────────────────────────────────────────
const SMOOTHING = 0.25;       // slightly faster tracking response
const MAX_MATCH_DIST = 0.22;  // more forgiving ID matching
const MAX_AGE = 10;           // keep ghost boxes longer

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
      const dist = Math.hypot(
        cx1 - (r.x + r.width / 2),
        cy1 - (r.y + r.height / 2)
      );
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
  const mx = w * 0.18;
  const mtop = h * 0.25;
  const mbot = h * 0.12;
  return {
    x: minX - mx, y: minY - mtop,
    width: w + mx * 2, height: h + mtop + mbot,
  };
}

// ─── Filter out WhatsApp UI false positives + hands/fingers ─────────
const UI_TOP_CUTOFF = 0.06;
const UI_BOTTOM_CUTOFF = 0.92;
const MIN_FACE_SIZE = 0.03;    // reject tiny "faces" (often noise/fingers)

function filterGlassesStreamFaces(faces: DetectedFace[]): DetectedFace[] {
  return faces.filter((f) => {
    const cy = f.y + f.height / 2;
    if (cy < UI_TOP_CUTOFF || cy > UI_BOTTOM_CUTOFF) return false;
    if (f.width < MIN_FACE_SIZE || f.height < MIN_FACE_SIZE) return false;

    // Aspect ratio filter: real faces are roughly 0.6–1.2 w/h ratio.
    // Fingers/hands tend to be very tall+narrow or very wide+flat.
    const aspect = f.width / f.height;
    if (aspect < 0.4 || aspect > 1.8) return false;

    return true;
  });
}

// ─── Init MediaPipe models (OPTIMIZED) ──────────────────────────────
async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );

  const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 8,                       // detect more faces
    minFaceDetectionConfidence: 0.4,   // balanced: catches faces, rejects hands
    minFacePresenceConfidence: 0.4,
    minTrackingConfidence: 0.35,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });

  const gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,                       // detect both hands
    minHandDetectionConfidence: 0.25,  // much more sensitive
    minHandPresenceConfidence: 0.25,
    minTrackingConfidence: 0.25,
  });

  console.log('[Models] FaceLandmarker + GestureRecognizer initialized (optimized)');
  return { faceLandmarker, gestureRecognizer };
}

// ─── Video display area ─────────────────────────────────────────────
interface DisplayArea {
  offsetX: number; offsetY: number; drawW: number; drawH: number;
}

function getVideoDisplayArea(
  video: HTMLVideoElement, cw: number, ch: number
): DisplayArea {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const va = vw / vh;
  const ca = cw / ch;
  let drawW: number, drawH: number, offsetX: number, offsetY: number;
  if (va > ca) {
    drawW = cw; drawH = cw / va; offsetX = 0; offsetY = (ch - drawH) / 2;
  } else {
    drawH = ch; drawW = ch * va; offsetX = (cw - drawW) / 2; offsetY = 0;
  }
  return { offsetX, offsetY, drawW, drawH };
}

// ─── Drawing ────────────────────────────────────────────────────────
function drawBoundingBoxes(
  ctx: CanvasRenderingContext2D,
  faces: SmoothedFace[],
  cw: number, ch: number,
  area: DisplayArea
) {
  ctx.clearRect(0, 0, cw, ch);
  for (const f of faces) {
    const x = area.offsetX + f.x * area.drawW;
    const y = area.offsetY + f.y * area.drawH;
    const w = f.width * area.drawW;
    const h = f.height * area.drawH;
    const alpha = f.age === 0 ? 1 : Math.max(0.15, 1 - f.age * 0.12);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.restore();
  }
}

// ─── Face cropping (headshot-style) ─────────────────────────────────
function cropFaceFromVideo(
  video: HTMLVideoElement,
  face: SmoothedFace
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const fx = face.x * vw;
  const fy = face.y * vh;
  const fw = face.width * vw;
  const fh = face.height * vh;

  // Headshot margins: 40% horizontal, 30% above, 80% below (shoulders)
  const mx = fw * 0.4;
  const mtop = fh * 0.3;
  const mbot = fh * 0.8;

  const sx = Math.max(0, Math.round(fx - mx));
  const sy = Math.max(0, Math.round(fy - mtop));
  const sx2 = Math.min(vw, Math.round(fx + fw + mx));
  const sy2 = Math.min(vh, Math.round(fy + fh + mbot));
  const sw = sx2 - sx;
  const sh = sy2 - sy;

  if (sw < 10 || sh < 10) return null;

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ─── Minimum hand size (fraction of frame width) ────────────────────
const MIN_HAND_SIZE = 0.04;

function isLargeEnoughHand(landmarks: { x: number; y: number }[]): boolean {
  let minX = 1, maxX = 0;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
  }
  return (maxX - minX) >= MIN_HAND_SIZE;
}

// ─── Component ─────────────────────────────────────────────────────
export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceDetectorRef = useRef<FaceLandmarker | null>(null);
  const gestureDetectorRef = useRef<GestureRecognizer | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastFaceTimeRef = useRef<number>(0);
  const lastGestureTimeRef = useRef<number>(0);

  // Gesture one-shot state
  const peaceActiveRef = useRef(false);
  const capturingRef = useRef(false);
  const recordingIdRef = useRef<string | null>(null);

  // Auto-capture during recording
  const lastAutoCaptureRef = useRef<number>(0);
  const knownFaceIdsRef = useRef<Set<number>>(new Set());

  // Audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState('Click a button below to start');
  const [faceCount, setFaceCount] = useState(0);
  const [detectionEnabled, setDetectionEnabled] = useState(true);
  const [resolution, setResolution] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [peaceDetected, setPeaceDetected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false); // ref mirror to avoid stale closures
  const [lastCapture, setLastCapture] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);

  // Recording timer
  const recordingStartRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Start audio capture (system audio from screen share ONLY) ──
  const startAudioCapture = useCallback(async () => {
    audioChunksRef.current = [];

    // Use audio from the screen share stream — NOT the laptop mic
    let audioStream: MediaStream | null = null;
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        audioStream = new MediaStream(audioTracks);
        console.log('[Audio] Using system audio from screen share');
      }
    }

    if (!audioStream) {
      console.warn('[Audio] No system audio available — share Entire Screen (not window) to capture call audio');
      return;
    }

    audioStreamRef.current = audioStream;

    try {
      const recorder = new MediaRecorder(audioStream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start(1000); // collect chunks every 1s
      mediaRecorderRef.current = recorder;
      console.log('[Audio] Recording started (system audio)');
    } catch (err) {
      console.error('[Audio] Failed to start MediaRecorder:', err);
    }
  }, []);

  // ─── Stop audio capture and return base64 ─────────────────────
  const stopAudioCapture = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;

        // Don't stop the audio tracks — they belong to the screen share stream
        audioStreamRef.current = null;

        if (blob.size < 100) {
          resolve(null);
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
        reader.readAsDataURL(blob);
      };

      recorder.stop();
    });
  }, []);

  // ─── Shared: attach stream ────────────────────────────────────
  const attachStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      const s = track.getSettings();
      setResolution(`${s.width}x${s.height}`);
      setSourceLabel(track.label);
      track.onended = () => stopCapture();
    }
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    setIsStreaming(true);
    setStatus('Live — Glasses Stream');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Capture Screen (share entire screen for video + system audio) ──
  const captureScreen = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus('Share your ENTIRE SCREEN (not window) for audio...');
    try {
      // Must share entire screen (not a window) to get system audio on Windows
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true,
      });
      const hasAudio = stream.getAudioTracks().length > 0;
      console.log(`[Capture] Got stream: video=${stream.getVideoTracks().length}, audio=${hasAudio}`);
      if (!hasAudio) {
        console.warn('[Capture] No audio track — user likely shared a window instead of screen');
      }
      attachStream(stream);
      setStatus(hasAudio ? 'Live — Screen + Audio' : 'Live — Screen (no audio — reshare as Entire Screen)');
    } catch {
      setStatus('Screen share cancelled');
    }
  }, [attachStream]);

  // ─── Camera device fallback ───────────────────────────────────
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        let vids = all.filter((d) => d.kind === 'videoinput');
        if (vids.length > 0 && !vids.some((d) => d.label)) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true });
            s.getTracks().forEach((t) => t.stop());
          } catch { /* */ }
          const all2 = await navigator.mediaDevices.enumerateDevices();
          vids = all2.filter((d) => d.kind === 'videoinput');
        }
        if (!cancelled) {
          setDevices(vids);
          const obs = vids.find((d) =>
            d.label.toLowerCase().includes('obs') ||
            d.label.toLowerCase().includes('virtual')
          );
          setSelectedDeviceId(obs?.deviceId ?? vids[0]?.deviceId ?? '');
        }
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const startCameraCapture = useCallback(async () => {
    if (!selectedDeviceId) return;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus('Opening camera...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selectedDeviceId } }, audio: false,
      });
      attachStream(stream);
    } catch {
      setStatus('Camera failed — use Capture OBS Window');
    }
  }, [selectedDeviceId, attachStream]);

  // ─── Stop ─────────────────────────────────────────────────────
  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsStreaming(false);
    setStatus('Stopped');
    setResolution('');
    setSourceLabel('');
    trackedFaces = [];
    nextFaceId = 0;
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ─── Toggle recording (3-finger gesture or manual button) ────
  const toggleRecording = useCallback(async () => {
    try {
      // Use ref (not state) to check current recording status
      // — avoids stale closure issues in the animation loop
      if (isRecordingRef.current && recordingIdRef.current) {
        // ── STOP recording ──
        const audioData = await stopAudioCapture();
        const res = await fetch('/api/recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop', audioData }),
        });
        if (res.ok) {
          recordingIdRef.current = null;
          isRecordingRef.current = false;
          setIsRecording(false);
          knownFaceIdsRef.current.clear();
          setLastCapture('Recording stopped');
          setTimeout(() => setLastCapture(''), 2000);
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          setRecordingTime(0);
        }
      } else if (!isRecordingRef.current) {
        // ── START recording ──
        const res = await fetch('/api/recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'toggle' }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.action === 'started') {
            recordingIdRef.current = data.session.id;
            isRecordingRef.current = true;
            setIsRecording(true);
            knownFaceIdsRef.current.clear();
            lastAutoCaptureRef.current = performance.now();
            setLastCapture('Recording started');
            setTimeout(() => setLastCapture(''), 2000);
            await startAudioCapture();
            recordingStartRef.current = Date.now();
            recordingTimerRef.current = setInterval(() => {
              setRecordingTime(Math.floor((Date.now() - recordingStartRef.current) / 1000));
            }, 1000);
          }
        }
      }
    } catch (err) {
      console.error('[Recording] Toggle failed:', err);
    }
  }, [startAudioCapture, stopAudioCapture]);

  // ─── Capture faces and send to /api/faces ─────────────────────
  const captureFaces = useCallback(async (source: 'peace' | 'auto' = 'peace') => {
    const video = videoRef.current;
    if (!video || capturingRef.current) return;

    const activeFaces = trackedFaces.filter((f) => f.age === 0);
    if (activeFaces.length === 0) return;

    capturingRef.current = true;
    let count = 0;

    for (const face of activeFaces) {
      const imgData = cropFaceFromVideo(video, face);
      if (!imgData) continue;

      try {
        const res = await fetch('/api/faces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: imgData }),
        });
        if (res.ok) {
          count++;
          // Link profile to active recording
          const data = await res.json();
          if (recordingIdRef.current && data.face?.id) {
            fetch('/api/recording', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'addProfile',
                profileId: data.face.id,
              }),
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('[Capture] Failed to send face:', err);
      }
    }

    if (count > 0 && source === 'peace') {
      setLastCapture(`Captured ${count} face${count > 1 ? 's' : ''}`);
      console.log(`[Capture] Sent ${count} face(s) to /api/faces`);
      setTimeout(() => setLastCapture(''), 3000);
    } else if (count > 0 && source === 'auto') {
      console.log(`[AutoCapture] Sent ${count} face(s) during recording`);
    }

    capturingRef.current = false;
  }, []);

  // ─── Detection Loop ───────────────────────────────────────────
  const runDetection = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const faceDetector = faceDetectorRef.current;
    const gestureDetector = gestureDetectorRef.current;

    if (!video || !canvas || !faceDetector || video.paused || video.ended) {
      animFrameRef.current = requestAnimationFrame(runDetection);
      return;
    }

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

    const now = performance.now();

    // ── Face detection at ~30 fps ──
    if (video.readyState >= 2 && now - lastFaceTimeRef.current > 33) {
      lastFaceTimeRef.current = now;
      try {
        const result = faceDetector.detectForVideo(video, now);
        const rawFaces: DetectedFace[] = (result.faceLandmarks || []).map(
          (lm) => landmarksToBBox(lm)
        );
        const filtered = filterGlassesStreamFaces(rawFaces);
        const smoothed = matchAndSmooth(filtered);
        const activeFaces = smoothed.filter((f) => f.age === 0);
        setFaceCount(activeFaces.length);
        const area = getVideoDisplayArea(video, canvas.width, canvas.height);
        drawBoundingBoxes(ctx, smoothed, canvas.width, canvas.height, area);

        // ── Auto-capture during recording ──
        if (recordingIdRef.current && activeFaces.length > 0) {
          // Check for new faces (IDs we haven't seen before)
          let newFaceFound = false;
          for (const f of activeFaces) {
            if (!knownFaceIdsRef.current.has(f.id)) {
              knownFaceIdsRef.current.add(f.id);
              newFaceFound = true;
            }
          }

          // Capture on new face or every 3 seconds
          const elapsed = now - lastAutoCaptureRef.current;
          if (newFaceFound || elapsed >= 3000) {
            lastAutoCaptureRef.current = now;
            captureFaces('auto');
          }
        }
      } catch { /* skip frame */ }
    }

    // ── Gesture detection at ~15 fps ──
    if (
      gestureDetector &&
      video.readyState >= 2 &&
      now - lastGestureTimeRef.current > 66
    ) {
      lastGestureTimeRef.current = now;
      try {
        const gResult = gestureDetector.recognizeForVideo(video, now);
        let foundPeace = false;

        if (gResult.gestures && gResult.gestures.length > 0) {
          for (let i = 0; i < gResult.gestures.length; i++) {
            const gestures = gResult.gestures[i];
            const landmarks = gResult.landmarks[i];
            if (!landmarks || !isLargeEnoughHand(landmarks)) continue;

            // Victory gesture with decent confidence
            const victory = gestures.find(
              (g) => g.categoryName === 'Victory' && g.score > 0.50
            );
            if (victory) foundPeace = true;
          }
        }

        // ── Peace sign: capture faces + toggle recording ──
        if (foundPeace) {
          setPeaceDetected(true);
          if (!peaceActiveRef.current) {
            peaceActiveRef.current = true;
            // Capture faces immediately
            captureFaces('peace');
            // Toggle recording on/off
            toggleRecording();
          }
        } else {
          setPeaceDetected(false);
          peaceActiveRef.current = false;
        }
      } catch { /* skip */ }
    }

    animFrameRef.current = requestAnimationFrame(runDetection);
  }, [captureFaces, toggleRecording]);

  // ─── Initialize models ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    initModels()
      .then(({ faceLandmarker, gestureRecognizer }) => {
        if (!cancelled) {
          faceDetectorRef.current = faceLandmarker;
          gestureDetectorRef.current = gestureRecognizer;
          console.log('[Models] Ready');
        }
      })
      .catch((err) => console.error('[Models] Init failed:', err));
    return () => {
      cancelled = true;
      faceDetectorRef.current?.close();
      gestureDetectorRef.current?.close();
    };
  }, []);

  // ─── Start/Stop Detection Loop ────────────────────────────────
  useEffect(() => {
    if (isStreaming && detectionEnabled) {
      animFrameRef.current = requestAnimationFrame(runDetection);
    } else {
      cancelAnimationFrame(animFrameRef.current);
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      setFaceCount(0);
      setPeaceDetected(false);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isStreaming, detectionEnabled, runDetection]);

  const getStatusColor = () => (isStreaming ? '#10b981' : '#a1a1a1');

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <h1 style={styles.title}>GlassesStream</h1>
        </div>
        <div style={styles.statusBadge}>
          <div style={{ ...styles.statusDot, backgroundColor: getStatusColor() }} />
          <span style={styles.statusText}>{status}</span>
        </div>
      </header>

      <main style={styles.main}>
        {/* Controls */}
        {!isStreaming ? (
          <div style={styles.controlsSection}>
            <button onClick={captureScreen} style={styles.btnPrimary}>
              Share Screen (with Call Audio)
            </button>
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>or try camera directly</span>
              <div style={styles.dividerLine} />
            </div>
            <div style={styles.controlsRow}>
              <select value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                style={styles.select}>
                <option value="">-- Select Camera --</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera #${i + 1}`}
                  </option>
                ))}
              </select>
              <button onClick={startCameraCapture} disabled={!selectedDeviceId}
                style={{
                  ...styles.btnSecondary,
                  opacity: selectedDeviceId ? 1 : 0.4,
                  cursor: selectedDeviceId ? 'pointer' : 'not-allowed',
                }}>
                Start
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.controlsSection}>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button onClick={stopCapture} style={{ ...styles.btnDanger, flex: 1 }}>
                Stop Stream
              </button>
              {isRecording && (
                <button onClick={toggleRecording} style={styles.btnStopRec}>
                  Stop Recording
                </button>
              )}
              {!isRecording && isStreaming && (
                <button onClick={toggleRecording} style={styles.btnStartRec}>
                  Start Rec
                </button>
              )}
            </div>
          </div>
        )}

        {/* Video */}
        <div style={{
          ...styles.videoWrapper,
          ...(isRecording ? { border: '2px solid #f59e0b', boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)' } : {}),
        }}>
          <video ref={videoRef} autoPlay playsInline muted
            style={{
              ...styles.video,
              opacity: isStreaming ? 1 : 0,
              position: isStreaming ? 'relative' : 'absolute',
            }}
          />
          {isStreaming && <canvas ref={canvasRef} style={styles.canvas} />}
          {isRecording && (
            <div style={styles.recBadge} onClick={toggleRecording} title="Click to stop recording">
              <div style={styles.recDot} />
              <span>REC {formatTime(recordingTime)} (click to stop)</span>
            </div>
          )}
          {!isStreaming && (
            <div style={styles.placeholder}>
              <div style={styles.placeholderInner}>
                <div style={styles.pulseContainer}>
                  <div style={styles.pulseRing} />
                  <div style={styles.pulseRingDelayed} />
                  <div style={{ color: '#3b82f6', opacity: 0.8 }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.5">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </div>
                </div>
                <h2 style={styles.placeholderTitle}>Ready</h2>
                <p style={styles.placeholderSubtitle}>
                  Click <strong>Share Screen</strong> and select <strong>Entire Screen</strong>
                  {' '}(not window) with <strong>Share system audio</strong> checked
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Capture toast */}
        {lastCapture && (
          <div style={styles.toast}>{lastCapture}</div>
        )}

        {/* Info Cards */}
        <div style={styles.infoRow}>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🕶️</div>
            <div>
              <div style={styles.infoLabel}>Source</div>
              <div style={styles.infoValue}>{sourceLabel || 'Not started'}</div>
            </div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>📐</div>
            <div>
              <div style={styles.infoLabel}>Resolution</div>
              <div style={styles.infoValue}>{resolution || '--'}</div>
            </div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🧑</div>
            <div>
              <div style={styles.infoLabel}>Faces</div>
              <div style={styles.infoValue}>{isStreaming ? faceCount : '--'}</div>
            </div>
          </div>
          {/* Peace sign / recording indicator */}
          <div style={{
            ...styles.infoCard,
            borderColor: isRecording ? '#f59e0b' : peaceDetected ? '#22c55e' : '#262626',
            backgroundColor: isRecording ? '#422006' : peaceDetected ? '#052e16' : '#141414',
          }}>
            <div style={styles.infoIcon}>{isRecording ? '🔴' : '✌️'}</div>
            <div>
              <div style={styles.infoLabel}>Peace Sign</div>
              <div style={{
                ...styles.infoValue,
                color: isRecording ? '#f59e0b' : peaceDetected ? '#22c55e' : '#666',
              }}>
                {isRecording ? `REC ${formatTime(recordingTime)}` : peaceDetected ? 'Detected!' : 'Show to record'}
              </div>
            </div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🔍</div>
            <div>
              <div style={styles.infoLabel}>Detection</div>
              <div style={{
                ...styles.infoValue, cursor: 'pointer',
                color: detectionEnabled ? '#10b981' : '#ef4444',
              }} onClick={() => setDetectionEnabled(!detectionEnabled)}>
                {detectionEnabled ? 'Active' : 'Paused'}{' '}
                <span style={{ fontSize: '11px', color: '#666' }}>(click)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Link to processor */}
        {isStreaming && (
          <a href="/processor" target="_blank" rel="noopener noreferrer"
            style={styles.processorLink}>
            Open Face Processor →
          </a>
        )}
      </main>

      <footer style={styles.footer}>
        <p style={styles.footerText}>
          Meta Glasses Stream • MediaPipe Face Landmarker + Gesture Recognizer
        </p>
      </footer>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────
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
  logo: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' },
  title: { fontSize: '20px', fontWeight: 600, margin: 0, letterSpacing: '-0.5px' },
  statusBadge: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '8px 16px', backgroundColor: '#1a1a1a',
    borderRadius: '9999px', border: '1px solid #262626',
  },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%' },
  statusText: { fontSize: '13px', fontWeight: 500, color: '#a1a1a1' },

  controlsSection: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '16px', width: '100%', maxWidth: '500px',
  },
  btnPrimary: {
    width: '100%', padding: '14px 24px', fontSize: '16px', fontWeight: 600,
    color: '#fff', backgroundColor: '#3b82f6', border: 'none',
    borderRadius: '10px', cursor: 'pointer',
  },
  btnSecondary: {
    padding: '10px 20px', fontSize: '14px', fontWeight: 600,
    color: '#fff', backgroundColor: '#333', border: '1px solid #444',
    borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
  btnDanger: {
    width: '100%', padding: '14px 24px', fontSize: '16px', fontWeight: 600,
    color: '#fff', backgroundColor: '#ef4444', border: 'none',
    borderRadius: '10px', cursor: 'pointer',
  },
  btnStopRec: {
    padding: '14px 20px', fontSize: '14px', fontWeight: 700,
    color: '#fff', backgroundColor: '#b91c1c', border: '2px solid #ef4444',
    borderRadius: '10px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
  btnStartRec: {
    padding: '14px 20px', fontSize: '14px', fontWeight: 600,
    color: '#fff', backgroundColor: '#065f46', border: '2px solid #10b981',
    borderRadius: '10px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
  divider: { display: 'flex', alignItems: 'center', gap: '12px', width: '100%' },
  dividerLine: { flex: 1, height: '1px', backgroundColor: '#333' },
  dividerText: { fontSize: '12px', color: '#666', whiteSpace: 'nowrap' as const },
  controlsRow: { display: 'flex', gap: '10px', alignItems: 'center', width: '100%' },
  select: {
    flex: 1, padding: '10px 14px', fontSize: '14px',
    backgroundColor: '#1a1a1a', color: '#fff',
    border: '1px solid #333', borderRadius: '8px', outline: 'none', cursor: 'pointer',
  },

  main: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '32px 24px', gap: '24px',
  },
  videoWrapper: {
    position: 'relative', width: '100%', maxWidth: '800px',
    aspectRatio: '16/9', backgroundColor: '#141414',
    borderRadius: '16px', overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    border: '1px solid #262626',
  },
  video: { width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' },
  canvas: {
    position: 'absolute', top: 0, left: 0,
    width: '100%', height: '100%', pointerEvents: 'none',
  },

  recBadge: {
    position: 'absolute', top: '12px', right: '12px',
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '6px 12px', backgroundColor: 'rgba(239, 68, 68, 0.9)',
    borderRadius: '8px', fontSize: '13px', fontWeight: 700,
    color: '#fff', zIndex: 10, cursor: 'pointer',
    pointerEvents: 'auto' as const,
  },
  recDot: {
    width: '10px', height: '10px', borderRadius: '50%',
    backgroundColor: '#fff',
    animation: 'blink 1s ease-in-out infinite',
  },

  placeholder: {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#141414',
  },
  placeholderInner: { textAlign: 'center', padding: '40px' },
  pulseContainer: {
    position: 'relative', width: '120px', height: '120px',
    margin: '0 auto 24px', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute', width: '100%', height: '100%',
    borderRadius: '50%', border: '2px solid #3b82f6',
    animation: 'pulse 2s ease-out infinite',
  },
  pulseRingDelayed: {
    position: 'absolute', width: '100%', height: '100%',
    borderRadius: '50%', border: '2px solid #3b82f6',
    animation: 'pulse 2s ease-out infinite', animationDelay: '1s',
  },
  placeholderTitle: { fontSize: '20px', fontWeight: 600, margin: '0 0 8px 0', color: '#fff' },
  placeholderSubtitle: { fontSize: '14px', color: '#666', margin: 0 },

  toast: {
    padding: '10px 20px', backgroundColor: '#052e16', color: '#22c55e',
    borderRadius: '8px', border: '1px solid #22c55e', fontSize: '14px', fontWeight: 500,
  },

  infoRow: {
    display: 'flex', gap: '12px', flexWrap: 'wrap',
    justifyContent: 'center', width: '100%', maxWidth: '900px',
  },
  infoCard: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 18px', backgroundColor: '#141414',
    borderRadius: '12px', border: '1px solid #262626', minWidth: '140px',
  },
  infoIcon: { fontSize: '22px' },
  infoLabel: {
    fontSize: '11px', color: '#666', textTransform: 'uppercase',
    letterSpacing: '0.5px', marginBottom: '2px',
  },
  infoValue: { fontSize: '14px', fontWeight: 500, color: '#fff' },

  processorLink: {
    padding: '10px 20px', fontSize: '14px', color: '#8b5cf6',
    textDecoration: 'none', border: '1px solid #8b5cf6',
    borderRadius: '8px', fontWeight: 500,
  },

  footer: { padding: '16px 24px', borderTop: '1px solid #1f1f1f', textAlign: 'center' },
  footerText: { fontSize: '12px', color: '#525252', margin: 0 },
};
