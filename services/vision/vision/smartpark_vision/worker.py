"""Camera worker: capture -> detect -> stabilize -> publish state transitions -> preview."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import httpx

from .detector import YoloVehicleDetector
from .logic import OccupancyStabilizer
from .sources import is_file_source, resolve_source

log = logging.getLogger("smartpark.vision.worker")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CameraWorker(threading.Thread):
    def __init__(self, config: dict[str, Any], *, api_url: str, token: str, media_root: Path,
                 allow_rtsp: bool, model: YoloVehicleDetector, detection_stride: int,
                 stable_frames: int, heartbeat_seconds: int):
        super().__init__(name=f"smartpark-camera-{config['id'][:8]}", daemon=True)
        self.config = config
        self.api_url = api_url.rstrip("/")
        self.token = token
        self.media_root = media_root
        self.allow_rtsp = allow_rtsp
        self.model = model
        self.detection_stride = max(1, detection_stride)
        self.stable_frames = max(1, stable_frames)
        self.heartbeat_seconds = max(2, heartbeat_seconds)
        self.stop_event = threading.Event()
        self.frame_lock = threading.Lock()
        self.latest_jpeg: bytes | None = None
        self.last_frame_at: str | None = None
        self.local_status = "configured"
        self.last_error: str | None = None
        self._client = httpx.Client(timeout=httpx.Timeout(6.0, connect=3.0), headers={"Authorization": f"Bearer {token}"})
        self._last_error_reported = None

    def stop(self) -> None:
        self.stop_event.set()

    def snapshot(self) -> dict[str, Any]:
        with self.frame_lock:
            return {"cameraId": self.config["id"], "name": self.config.get("name", "Camera"),
                    "status": self.local_status, "lastFrameAt": self.last_frame_at, "lastError": self.last_error,
                    "hasPreview": self.latest_jpeg is not None}

    def preview(self) -> bytes | None:
        with self.frame_lock:
            return self.latest_jpeg

    def _set_status(self, status: str, error: str | None = None) -> None:
        with self.frame_lock:
            self.local_status = status
            self.last_error = error
        if status not in {"online"}:
            self._report_health(status, error)

    def _report_health(self, status: str, message: str | None) -> None:
        try:
            self._client.post(f"{self.api_url}/cameras/{self.config['id']}/health", json={"status": status, "message": message})
        except Exception as exc:
            log.warning("Camera %s could not publish health: %s", self.config['id'], exc)

    def _publish(self, events: list[dict[str, Any]], frame_at: str) -> None:
        try:
            response = self._client.post(f"{self.api_url}/events", json={
                "cameraId": self.config["id"], "frameAt": frame_at, "events": events
            })
            response.raise_for_status()
            with self.frame_lock:
                self.local_status = "online"
                self.last_error = None
                self.last_frame_at = frame_at
        except Exception as exc:
            self._set_status("offline", f"Could not publish occupancy to SmartPark API: {exc}")

    def _draw_regions(self, frame, states: dict[str, str]) -> Any:
        h, w = frame.shape[:2]
        output = frame.copy()
        for region in self.config.get("regions") or []:
            points = region.get("points") or []
            if len(points) < 3:
                continue
            pts = [
                [
                    int(min(w - 1, max(0, round(float(x) * (w - 1))))),
                    int(min(h - 1, max(0, round(float(y) * (h - 1)))))
                ]
                for x, y in points
            ]
            import numpy as np
            polygon = np.asarray(pts, dtype=np.int32).reshape((-1, 1, 2))
            slot_id = str(region.get("slotId"))
            state = states.get(slot_id, "unknown")
            color = {"empty": (45, 195, 105), "occupied": (55, 65, 230), "unknown": (30, 185, 230)}.get(state, (30, 185, 230))
            cv2.polylines(output, [polygon], True, color, 3, cv2.LINE_AA)
            x = int(sum(p[0] for p in pts) / len(pts)); y = int(sum(p[1] for p in pts) / len(pts))
            label = f"{region.get('slotCode', slot_id[:6])} · {state.upper()}"
            cv2.rectangle(output, (max(0, x - 6), max(0, y - 21)), (min(w - 1, x + max(76, len(label) * 8)), y + 3), color, -1)
            cv2.putText(output, label, (max(0, x), max(14, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (255, 255, 255), 1, cv2.LINE_AA)
        return output

    def _save_preview(self, frame) -> None:
        success, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
        if not success:
            return
        with self.frame_lock:
            self.latest_jpeg = encoded.tobytes()

    def run(self) -> None:
        # The camera preview must be available before regions are configured, otherwise
        # operators would have to guess polygon coordinates without seeing the frame.
        backoff = 3.0
        while not self.stop_event.is_set():
            capture = None
            try:
                source, file_source = resolve_source(self.config.get("streamReference", ""), self.media_root, self.allow_rtsp)
                capture = cv2.VideoCapture(source)
                if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
                    capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
                if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
                    capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
                capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                if not capture.isOpened():
                    raise RuntimeError("OpenCV could not open the configured video source.")

                stabilizer = OccupancyStabilizer([str(r["slotId"]) for r in self.config.get("regions", [])], self.stable_frames)
                frame_number = 0
                last_heartbeat = 0.0
                read_failures = 0
                backoff = 3.0
                log.info("Camera %s connected to source %s", self.config["id"], "local video" if file_source else "configured stream")

                while not self.stop_event.is_set():
                    ok, frame = capture.read()
                    if not ok or frame is None:
                        if file_source:
                            capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            read_failures += 1
                            if read_failures <= 2:
                                self.stop_event.wait(0.1)
                                continue
                        raise RuntimeError("No frame received from the camera source; check the file, camera or network stream.")
                    read_failures = 0
                    frame_number += 1
                    if frame_number % self.detection_stride != 0:
                        continue

                    if self.config.get("regions"):
                        observations, annotated = self.model.detect(frame, self.config)
                        changed_events = stabilizer.update(observations)
                        states = stabilizer.current_states()
                        annotated = self._draw_regions(annotated, states)
                    else:
                        changed_events = []
                        annotated = frame.copy()
                        cv2.putText(annotated, "Camera connected - map slot regions in SmartPark", (18, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (45, 195, 105), 2, cv2.LINE_AA)
                    self._save_preview(annotated)
                    frame_at = utc_now_iso()
                    now = time.monotonic()
                    if changed_events or now - last_heartbeat >= self.heartbeat_seconds:
                        self._publish(changed_events, frame_at)
                        last_heartbeat = now
                    else:
                        with self.frame_lock:
                            self.last_frame_at = frame_at
                            self.local_status = "online"
                            self.last_error = None
                # End inner capture loop on shutdown.
            except Exception as exc:
                message = str(exc)[:500]
                if message != self._last_error_reported:
                    log.error("Camera %s is offline: %s", self.config["id"], message)
                    self._last_error_reported = message
                self._set_status("offline", message)
                self.stop_event.wait(backoff)
                backoff = min(30.0, backoff * 1.5)
            finally:
                if capture is not None:
                    capture.release()
        self._client.close()
