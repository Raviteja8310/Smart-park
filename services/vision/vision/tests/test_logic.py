import unittest

from smartpark_vision.logic import OccupancyStabilizer, validate_polygon


class PolygonTests(unittest.TestCase):
    def test_accepts_normalized_rectangle(self):
        result = validate_polygon([[0.1, 0.1], [0.5, 0.1], [0.5, 0.7], [0.1, 0.7]])
        self.assertEqual(len(result), 4)

    def test_rejects_out_of_range_points(self):
        with self.assertRaisesRegex(ValueError, "between 0 and 1"):
            validate_polygon([[0, 0], [1.2, 0], [0, 1]])

    def test_rejects_collinear_polygon(self):
        with self.assertRaisesRegex(ValueError, "non-zero area"):
            validate_polygon([[0, 0], [0.2, 0.2], [0.4, 0.4]])

    def test_rejects_boolean_coordinates(self):
        with self.assertRaisesRegex(ValueError, "numbers"):
            validate_polygon([[False, 0], [1, 0], [0, 1]])


class StabilizerTests(unittest.TestCase):
    def test_requires_consecutive_stable_frames_and_emits_only_changes(self):
        state = OccupancyStabilizer(["slot-a"], stable_frames=3)
        self.assertEqual(state.update({"slot-a": ("occupied", 0.87)}), [])
        self.assertEqual(state.update({"slot-a": ("occupied", 0.88)}), [])
        changes = state.update({"slot-a": ("occupied", 0.89)})
        self.assertEqual(changes[0]["observedState"], "occupied")
        self.assertEqual(state.update({"slot-a": ("occupied", 0.90)}), [])

    def test_empty_state_requires_its_own_stability_window(self):
        state = OccupancyStabilizer(["slot-a"], stable_frames=2)
        state.update({"slot-a": ("occupied", 0.9)})
        state.update({"slot-a": ("occupied", 0.9)})
        state.update({"slot-a": ("occupied", 0.9)})
        self.assertEqual(state.update({"slot-a": ("empty", 0.8)}), [])
        changes = state.update({"slot-a": ("empty", 0.8)})
        self.assertEqual(changes[0]["observedState"], "empty")

    def test_unknown_does_not_falsely_advance_empty_state(self):
        state = OccupancyStabilizer(["slot-a"], stable_frames=2)
        state.update({"slot-a": ("empty", 0.8)})
        self.assertEqual(state.update({"slot-a": ("unknown", None)}), [])
        self.assertEqual(state.current_states()["slot-a"], "unknown")
        self.assertEqual(state.update({"slot-a": ("empty", 0.8)}), [])
        self.assertEqual(state.update({"slot-a": ("empty", 0.8)})[0]["observedState"], "empty")


if __name__ == "__main__":
    unittest.main()
