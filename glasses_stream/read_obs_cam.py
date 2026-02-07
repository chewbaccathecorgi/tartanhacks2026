import cv2
import time

# OBS Virtual Camera index (yours was 1)
CAM_INDEX = 1

# Request capture resolution (may be ignored by the virtual camera)
CAP_W, CAP_H = 540, 960   # portrait; try 720,1280 later if OBS is set that way

# Preview window size (UI only)
WIN_W, WIN_H = 360, 640

win_name = "WhatsApp Feed via OBS"

cap = cv2.VideoCapture(CAM_INDEX, cv2.CAP_DSHOW)
if not cap.isOpened():
    raise RuntimeError(
        f"Could not open camera index {CAM_INDEX}. "
        "Make sure OBS Virtual Camera is ON and CAM_INDEX is correct."
    )

# OPTION B: request a capture resolution
cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAP_W)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAP_H)

# Print what we actually got (virtual cams sometimes ignore requested sizes)
actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"Requested capture: {CAP_W}x{CAP_H}")
print(f"Actual capture:    {actual_w}x{actual_h}")

# Make the OpenCV window resizable + set a sane preview size
cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
cv2.resizeWindow(win_name, WIN_W, WIN_H)

print("Press 'q' to quit.")

# Debug counters
count = 0
t0 = time.time()

while True:
    ok, frame = cap.read()
    if not ok or frame is None:
        continue

    count += 1

    # Every ~60 frames, print the actual frame shape and approximate FPS
    if count % 60 == 0:
        h, w = frame.shape[:2]
        dt = time.time() - t0
        fps = 60.0 / dt if dt > 0 else 0.0
        print(f"Frame shape: {w}x{h} | ~FPS: {fps:.1f}")
        t0 = time.time()

    cv2.imshow(win_name, frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
