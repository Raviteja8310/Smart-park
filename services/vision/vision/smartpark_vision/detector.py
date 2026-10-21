"""YOLO vehicle detection mapped onto operator-configured parking-space polygons."""
from __future__ import annotations

import threading
from typing import Any

import cv2
import numpy as np


class YoloVehicleDetector:
    """Loads one YOLO model and serializes inference shared by camera workers.

    COCO class IDs used: car=2, motorcycle=3, bus=5, truck=7.
    """

    VEHICLE_CLASS_IDS = {2, 3, 5, 7}

    def __init__(self, model_path: str):
        self.model_path = model_path
        self._model: Any | None = None
        self._model_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    def _get_model(self):
        with self._model_lock:
            if self._model is not None:
                return self._model
            try:
                from ultralytics import YOLO
            except ImportError as exc:
                raise RuntimeError(
                    "YOLO support is not installed. Run `pip install -r requirements-yolo.txt` "
                    "inside services/vision, then restart the vision service."
                ) from exc
            try:
                self._model = YOLO(self.model_path)
            except Exception as exc:
                raise RuntimeError(f"Unable to load YOLO model '{self.model_path}': {exc}") from exc
            return self._model

    @staticmethod
    def _polygon_pixels(points: list[list[float]], width: int, height: int) -> np.ndarray:
        coords = []
        for point in points:
            coords.append([
                min(width - 1, max(0, round(float(point[0]) * (width - 1)))),
                min(height - 1, max(0, round(float(point[1]) * (height - 1))))
            ])
        return np.asarray(coords, dtype=np.int32).reshape((-1, 1, 2))

    @staticmethod
    def _box_overlaps_polygon(box: tuple[int, int, int, int], polygon: np.ndarray, mask: np.ndarray, polygon_area: int) -> bool:
        x1, y1, x2, y2 = box
        height, width = mask.shape[:2]
        x1 = min(width, max(0, x1)); x2 = min(width, max(0, x2))
        y1 = min(height, max(0, y1)); y2 = min(height, max(0, y2))
        if x2 <= x1 or y2 <= y1 or polygon_area <= 0:
            return False
        box_area = max(1, (x2 - x1) * (y2 - y1))
        overlapping = int(cv2.countNonZero(mask[y1:y2, x1:x2]))
        center = ((x1 + x2) // 2, (y1 + y2) // 2)
        center_inside = cv2.pointPolygonTest(polygon, center, False) >= 0
        # A center-in-region test handles most parked vehicles; the overlap test allows
        # vehicles whose bounding-box center crosses the edge of a bay.
        return center_inside or overlapping / max(1, min(polygon_area, box_area)) >= 0.12

    def detect(self, frame: np.ndarray, camera: dict[str, Any]) -> tuple[dict[str, tuple[str, float | None]], np.ndarray]:
        height, width = frame.shape[:2]
        region_data = camera.get("regions") or []
        polygons: dict[str, np.ndarray] = {}
        masks: dict[str, np.ndarray] = {}
        polygon_areas: dict[str, int] = {}
        for region in region_data:
            points = region.get("points") or []
            if len(points) < 3:
                continue
            polygon = self._polygon_pixels(points, width, height)
            mask = np.zeros((height, width), dtype=np.uint8)
            cv2.fillPoly(mask, [polygon], 255)
            polygons[str(region["slotId"])] = polygon
            masks[str(region["slotId"])] = mask
            polygon_areas[str(region["slotId"])] = int(cv2.countNonZero(mask))

        model = self._get_model()
        with self._inference_lock:
            result = model.predict(
                source=frame,
                conf=float(camera.get("confidenceThreshold", 0.25)),
                classes=sorted(self.VEHICLE_CLASS_IDS),
                imgsz=640,
                verbose=False
            )[0]

        boxes: list[tuple[tuple[int, int, int, int], float, int]] = []
        if result.boxes is not None:
            for detected_box in result.boxes:
                class_id = int(detected_box.cls[0].item())
                confidence = float(detected_box.conf[0].item())
                coords = [int(round(float(v))) for v in detected_box.xyxy[0].tolist()]
                boxes.append(((coords[0], coords[1], coords[2], coords[3]), confidence, class_id))

        observations: dict[str, tuple[str, float | None]] = {}
        for slot_id, polygon in polygons.items():
            hits = [
                confidence for box, confidence, _class_id in boxes
                if self._box_overlaps_polygon(box, polygon, masks[slot_id], polygon_areas[slot_id])
            ]
            if hits:
                observations[slot_id] = ("occupied", max(hits))
            else:
                # This is confidence in a model pass finding no overlapping vehicle,
                # not a guarantee that the space is bookable.
                observations[slot_id] = ("empty", 0.90)

        annotated = frame.copy()
        for box, confidence, class_id in boxes:
            x1, y1, x2, y2 = box
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 190, 35), 2)
            cv2.putText(annotated, f"vehicle {confidence:.2f}", (x1, max(18, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 190, 35), 1, cv2.LINE_AA)
        return observations, annotated
