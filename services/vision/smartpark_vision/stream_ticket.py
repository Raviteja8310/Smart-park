"""Validation for short-lived browser preview tickets issued by the Node API."""
import base64
import hashlib
import hmac
import json
import time


def verify_stream_ticket(ticket: str, camera_id: str, secret: str, now: int | None = None) -> bool:
    if not secret or not ticket or len(ticket) > 2048:
        return False
    try:
        payload_segment, supplied_signature = ticket.split('.', 1)
        expected_signature = hmac.new(secret.encode(), payload_segment.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_signature, supplied_signature):
            return False
        padding = '=' * (-len(payload_segment) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_segment + padding))
        current = int(time.time()) if now is None else int(now)
        expiry = int(payload.get('exp', 0))
        return payload.get('cameraId') == camera_id and current <= expiry <= current + 300
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return False
