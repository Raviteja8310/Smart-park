"""SmartPark Vision API and MJPEG preview service."""
from __future__ import annotations

import importlib.util
import logging
import os
import time
from pathlib import Path
from typing import Iterator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env", override=False)
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("smartpark.vision")

VISION_API_TOKEN = os.getenv("VISION_API_TOKEN", "").strip()
VISION_API_URL = os.getenv("VISION_API_URL", "http://127.0.0.1:4000/api/vision/service").rstrip("/")
VISION_HOST = os.getenv("VISION_HOST", "127.0.0.1")
VISION_PORT = int(os.getenv("VISION_PORT", "8000"))
VISION_POLL_SECONDS = int(os.getenv("VISION_POLL_SECONDS", "10"))
VISION_HEARTBEAT_SECONDS = int(os.getenv("VISION_HEARTBEAT_SECONDS", "10"))
VISION_DETECTION_EVERY_N_FRAMES = int(os.getenv("VISION_DETECTION_EVERY_N_FRAMES", "3"))
VISION_STABLE_FRAMES = int(os.getenv("VISION_STABLE_FRAMES", "3"))
VISION_MODEL_PATH = os.getenv("VISION_MODEL_PATH", "yolov8n.pt")
VISION_ALLOW_RTSP = os.getenv("VISION_ALLOW_RTSP", "false").lower() == "true"
VISION_MAX_WORKERS = int(os.getenv("VISION_MAX_WORKERS", "6"))
VISION_MEDIA_ROOT_VALUE = Path(os.getenv("VISION_MEDIA_ROOT", "services/vision/sample-videos"))
VISION_MEDIA_ROOT = VISION_MEDIA_ROOT_VALUE if VISION_MEDIA_ROOT_VALUE.is_absolute() else (PROJECT_ROOT / VISION_MEDIA_ROOT_VALUE)

if not VISION_API_TOKEN:
    log.warning("VISION_API_TOKEN is empty. The vision service will start, but it cannot connect to the SmartPark API.")

from .supervisor import CameraSupervisor  # noqa: E402
from .stream_ticket import verify_stream_ticket  # noqa: E402

supervisor = CameraSupervisor(
    api_url=VISION_API_URL,
    token=VISION_API_TOKEN,
    media_root=VISION_MEDIA_ROOT,
    allow_rtsp=VISION_ALLOW_RTSP,
    poll_seconds=VISION_POLL_SECONDS,
    detection_stride=VISION_DETECTION_EVERY_N_FRAMES,
    stable_frames=VISION_STABLE_FRAMES,
    heartbeat_seconds=VISION_HEARTBEAT_SECONDS,
    max_workers=VISION_MAX_WORKERS,
    model_path=VISION_MODEL_PATH,
)
app = FastAPI(title="SmartPark Vision Service", version="1.0.0")


@app.on_event("startup")
def start_supervisor() -> None:
    VISION_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    supervisor.start()


@app.on_event("shutdown")
def stop_supervisor() -> None:
    supervisor.stop()


@app.get("/health")
def health() -> dict:
    return {
        "service": "smartpark-vision",
        "status": "ok" if VISION_API_TOKEN else "degraded",
        "apiConfigured": bool(VISION_API_TOKEN),
        "yoloPackageInstalled": importlib.util.find_spec("ultralytics") is not None,
        "modelPath": VISION_MODEL_PATH,
        "lastConfigFetchAt": supervisor.last_config_fetch_at,
        "lastConfigError": supervisor.last_config_error,
        "workers": supervisor.snapshots(),
    }


def _valid_stream_ticket(ticket: str, camera_id: str) -> bool:
    return verify_stream_ticket(ticket, camera_id, VISION_API_TOKEN)


@app.get("/vision-stream/{camera_id}")
def stream_camera(camera_id: str, ticket: str = Query(default="")):
    if not _valid_stream_ticket(ticket, camera_id):
        raise HTTPException(status_code=403, detail="A valid short-lived camera stream ticket is required.")
    worker = supervisor.get_worker(camera_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="No active vision worker is configured for this camera.")
    if not worker.preview():
        raise HTTPException(status_code=503, detail="Camera preview is not available yet. Check the stream and configured slot regions.")

    def frames() -> Iterator[bytes]:
        last_frame: bytes | None = None
        while True:
            current_worker = supervisor.get_worker(camera_id)
            if current_worker is None:
                break
            frame = current_worker.preview()
            if frame and frame != last_frame:
                last_frame = frame
                yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"
            time.sleep(0.1)

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.exception_handler(Exception)
async def handle_unexpected_error(_request, exc: Exception):
    log.error("Unhandled vision-service error: %s", exc)
    return JSONResponse(status_code=500, content={"error": "Internal vision-service error."})
