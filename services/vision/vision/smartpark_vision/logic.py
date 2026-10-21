"""Pure Python helpers for region validation and occupancy stabilization."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

VALID_STATES = {"empty", "occupied", "unknown"}


def validate_polygon(points: object) -> list[tuple[float, float]]:
    if not isinstance(points, list) or not 3 <= len(points) <= 16:
        raise ValueError("A region must contain between 3 and 16 normalized points.")
    normalized: list[tuple[float, float]] = []
    for point in points:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError("Every polygon point must be an [x, y] pair.")
        x, y = point
        if isinstance(x, bool) or isinstance(y, bool):
            raise ValueError("Polygon coordinates must be numbers.")
        if not isinstance(x, (float, int)) or not isinstance(y, (float, int)):
            raise ValueError("Polygon coordinates must be numbers.")
        if not (0 <= float(x) <= 1 and 0 <= float(y) <= 1):
            raise ValueError("Polygon coordinates must be between 0 and 1.")
        normalized.append((float(x), float(y)))
    if len(set(normalized)) < 3:
        raise ValueError("A region must contain at least three distinct points.")
    area = sum(
        normalized[i][0] * normalized[(i + 1) % len(normalized)][1]
        - normalized[(i + 1) % len(normalized)][0] * normalized[i][1]
        for i in range(len(normalized))
    )
    if abs(area) < 1e-6:
        raise ValueError("Polygon points must form a non-zero area.")
    return normalized


@dataclass
class SlotTrack:
    state: str = "unknown"
    candidate: str = "unknown"
    count: int = 0
    confidence: float | None = None


class OccupancyStabilizer:
    """Emits a state only after the same detector result is observed N times."""

    def __init__(self, slot_ids: Iterable[str], stable_frames: int = 3):
        self.stable_frames = max(1, int(stable_frames))
        self.tracks = {slot_id: SlotTrack() for slot_id in slot_ids}

    def reset_slots(self, slot_ids: Iterable[str]) -> None:
        old = self.tracks
        self.tracks = {slot_id: old.get(slot_id, SlotTrack()) for slot_id in slot_ids}

    def update(self, observations: dict[str, tuple[str, float | None]]) -> list[dict[str, object]]:
        changes: list[dict[str, object]] = []
        for slot_id, track in self.tracks.items():
            state, confidence = observations.get(slot_id, ("unknown", None))
            if state not in VALID_STATES:
                state, confidence = "unknown", None
            if state == "unknown":
                track.candidate = "unknown"
                track.count = 0
                track.confidence = None
                continue
            if state == track.candidate:
                track.count += 1
            else:
                track.candidate = state
                track.count = 1
                track.confidence = confidence
            if confidence is not None:
                track.confidence = confidence if track.confidence is None else max(track.confidence, confidence)
            if track.count >= self.stable_frames and track.state != state:
                track.state = state
                changes.append({"slotId": slot_id, "observedState": state, "confidence": track.confidence})
        return changes

    def current_states(self) -> dict[str, str]:
        return {slot_id: track.state for slot_id, track in self.tracks.items()}
