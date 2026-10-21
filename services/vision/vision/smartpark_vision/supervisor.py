"""Reconciles configured cameras from SmartPark API and manages worker threads."""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from .detector import YoloVehicleDetector
from .worker import CameraWorker

log = logging.getLogger("smartpark.vision.supervisor")


class CameraSupervisor:
    def __init__(self, *, api_url: str, token: str, media_root: Path, allow_rtsp: bool,
                 poll_seconds: int, detection_stride: int, stable_frames: int,
                 heartbeat_seconds: int, max_workers: int, model_path: str):
        self.api_url = api_url.rstrip("/")
        self.token = token
        self.media_root = media_root
        self.allow_rtsp = allow_rtsp
        self.poll_seconds = max(3, poll_seconds)
        self.detection_stride = max(1, detection_stride)
        self.stable_frames = max(1, stable_frames)
        self.heartbeat_seconds = max(3, heartbeat_seconds)
        self.max_workers = max(1, max_workers)
        self.model = YoloVehicleDetector(model_path)
        self._workers: dict[str, CameraWorker] = {}
        self._fingerprints: dict[str, str] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.RLock()
        self.last_config_error: str | None = None
        self.last_config_fetch_at: str | None = None
        self._client = httpx.Client(timeout=httpx.Timeout(10.0, connect=3.0), headers={"Authorization": f"Bearer {token}"})

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="smartpark-camera-supervisor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            workers = list(self._workers.values())
        for worker in workers:
            worker.stop()
        if self._thread:
            self._thread.join(timeout=5)
        for worker in workers:
            worker.join(timeout=5)
        self._client.close()

    def _fingerprint(self, config: dict[str, Any]) -> str:
        clean = json.dumps(config, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(clean.encode()).hexdigest()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                response = self._client.get(f"{self.api_url}/config")
                response.raise_for_status()
                payload = response.json()
                cameras = payload.get("cameras") or []
                self.last_config_error = None
                self.last_config_fetch_at = payload.get("fetchedAt")
                self._reconcile(cameras)
            except Exception as exc:
                self.last_config_error = str(exc)[:500]
                log.warning("Unable to read SmartPark camera configuration: %s", exc)
            self._stop.wait(self.poll_seconds)

    def _reconcile(self, configs: list[dict[str, Any]]) -> None:
        desired = {str(camera["id"]): camera for camera in configs if camera.get("id")}
        with self._lock:
            for camera_id in list(self._workers):
                if camera_id not in desired:
                    worker = self._workers.pop(camera_id)
                    self._fingerprints.pop(camera_id, None)
                    worker.stop()

            for camera_id, config in desired.items():
                fingerprint = self._fingerprint(config)
                existing = self._workers.get(camera_id)
                if existing and self._fingerprints.get(camera_id) == fingerprint and existing.is_alive():
                    continue
                if existing:
                    existing.stop()
                    existing.join(timeout=3)
                    self._workers.pop(camera_id, None)
                    self._fingerprints.pop(camera_id, None)
                if len(self._workers) >= self.max_workers:
                    log.warning("Camera %s was not started: VISION_MAX_WORKERS=%s limit reached", camera_id, self.max_workers)
                    continue
                worker = CameraWorker(
                    config,
                    api_url=self.api_url,
                    token=self.token,
                    media_root=self.media_root,
                    allow_rtsp=self.allow_rtsp,
                    model=self.model,
                    detection_stride=self.detection_stride,
                    stable_frames=self.stable_frames,
                    heartbeat_seconds=self.heartbeat_seconds,
                )
                self._workers[camera_id] = worker
                self._fingerprints[camera_id] = fingerprint
                worker.start()
                log.info("Started camera worker %s (%s)", camera_id, config.get("name", "camera"))

    def snapshots(self) -> list[dict[str, Any]]:
        with self._lock:
            return [worker.snapshot() for worker in self._workers.values()]

    def get_worker(self, camera_id: str) -> CameraWorker | None:
        with self._lock:
            return self._workers.get(camera_id)
