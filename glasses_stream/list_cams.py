import cv2

def test_index(i):
    cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return False
    ok, frame = cap.read()
    cap.release()
    return ok and frame is not None

print("Testing camera indexes 0..10")
for i in range(11):
    ok = test_index(i)
    print(f"{i}: {'OK' if ok else 'NO'}")
