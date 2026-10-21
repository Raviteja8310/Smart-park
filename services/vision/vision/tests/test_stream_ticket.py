import base64
import hashlib
import hmac
import json
import unittest

from smartpark_vision.stream_ticket import verify_stream_ticket


def make_ticket(camera_id, expires_at, secret):
    payload = base64.urlsafe_b64encode(json.dumps({"cameraId": camera_id, "exp": expires_at}).encode()).decode().rstrip('=')
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


class StreamTicketTests(unittest.TestCase):
    def test_accepts_valid_ticket_for_camera(self):
        ticket = make_ticket("camera-123", 1120, "test-secret")
        self.assertTrue(verify_stream_ticket(ticket, "camera-123", "test-secret", now=1000))

    def test_rejects_ticket_for_different_camera(self):
        ticket = make_ticket("camera-123", 1120, "test-secret")
        self.assertFalse(verify_stream_ticket(ticket, "camera-other", "test-secret", now=1000))

    def test_rejects_expired_ticket(self):
        ticket = make_ticket("camera-123", 999, "test-secret")
        self.assertFalse(verify_stream_ticket(ticket, "camera-123", "test-secret", now=1000))

    def test_rejects_tampered_signature_and_empty_secret(self):
        ticket = make_ticket("camera-123", 1120, "test-secret")
        self.assertFalse(verify_stream_ticket(ticket + 'x', "camera-123", "test-secret", now=1000))
        self.assertFalse(verify_stream_ticket(ticket, "camera-123", "", now=1000))

    def test_rejects_ticket_with_excessive_expiry(self):
        ticket = make_ticket("camera-123", 1500, "test-secret")
        self.assertFalse(verify_stream_ticket(ticket, "camera-123", "test-secret", now=1000))


if __name__ == "__main__":
    unittest.main()
