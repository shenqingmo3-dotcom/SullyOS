import random
import unittest

import pattern_engine


class PatternCatalogTests(unittest.TestCase):
    def test_catalog_has_two_boards_ten_groups_and_fifty_variants(self) -> None:
        self.assertEqual(len(pattern_engine.BOARD_LABELS), 2)
        self.assertEqual(len(pattern_engine.SCENE_LABELS), 5)
        self.assertEqual(len(pattern_engine.VARIANTS_BY_GROUP), 10)
        self.assertEqual(len(pattern_engine.VARIANTS), 50)
        self.assertTrue(
            all(
                len(variants) == 5
                for variants in pattern_engine.VARIANTS_BY_GROUP.values()
            )
        )

    def test_suction_only_never_generates_vibration(self) -> None:
        for scene in pattern_engine.SCENE_LABELS:
            for variant in pattern_engine.VARIANTS_BY_GROUP[
                ("suction_only", scene)
            ]:
                points = pattern_engine.generate_round(variant, strength=5)
                self.assertTrue(all(point.vibration == 0 for point in points))
                self.assertTrue(any(point.suction > 0 for point in points))

    def test_combined_variants_drive_both_channels(self) -> None:
        for scene in pattern_engine.SCENE_LABELS:
            for variant in pattern_engine.VARIANTS_BY_GROUP[("combined", scene)]:
                points = pattern_engine.generate_round(variant, strength=3)
                self.assertTrue(any(point.vibration > 0 for point in points))
                self.assertTrue(any(point.suction > 0 for point in points))

    def test_every_variant_in_a_group_has_a_distinct_waveform(self) -> None:
        for group, variants in pattern_engine.VARIANTS_BY_GROUP.items():
            signatures = set()
            for variant in variants:
                points = pattern_engine.generate_round(variant, strength=3)
                signatures.add(
                    tuple(
                        (point.vibration, point.suction)
                        for point in points
                    )
                )
            self.assertEqual(len(signatures), 5, group)

    def test_generated_values_stay_in_device_range(self) -> None:
        for variant in pattern_engine.VARIANTS:
            for strength in range(1, 6):
                points = pattern_engine.generate_round(variant, strength)
                self.assertTrue(
                    all(
                        0 <= point.vibration <= 100
                        and 0 <= point.suction <= 100
                        for point in points
                    )
                )

    def test_strength_level_increases_or_preserves_channel_peaks(self) -> None:
        for variant in pattern_engine.VARIANTS:
            previous_vibration = 0
            previous_suction = 0
            for strength in range(1, 6):
                points = pattern_engine.generate_round(variant, strength)
                vibration, suction = pattern_engine.peak_intensities(points)
                self.assertGreaterEqual(vibration, previous_vibration)
                self.assertGreaterEqual(suction, previous_suction)
                previous_vibration = vibration
                previous_suction = suction

    def test_directional_variant_names_match_the_first_active_channel(self) -> None:
        expectations = {
            "combined.gentle.3": "suction",
            "combined.tease.1": "vibration",
            "combined.tease.2": "suction",
        }
        for variant_id, expected_channel in expectations.items():
            variant = pattern_engine.VARIANTS_BY_ID[variant_id]
            points = pattern_engine.generate_round(variant, strength=2)
            first_vibration = next(
                index for index, point in enumerate(points) if point.vibration > 0
            )
            first_suction = next(
                index for index, point in enumerate(points) if point.suction > 0
            )
            if expected_channel == "vibration":
                self.assertLess(first_vibration, first_suction, variant_id)
            else:
                self.assertLess(first_suction, first_vibration, variant_id)
            self.assertGreaterEqual(
                abs(first_vibration - first_suction),
                3,
                f"{variant_id} should have at least 150ms of perceptible lead",
            )

    def test_synchronous_variants_have_matching_on_off_timing(self) -> None:
        synchronous_ids = {
            "combined.gentle.1",
            "combined.tease.4",
            "combined.reward.1",
            "combined.reward.2",
            "combined.reward.4",
            "combined.intense.1",
            "combined.intense.4",
            "combined.punishment.3",
        }
        for variant_id in synchronous_ids:
            points = pattern_engine.generate_round(
                pattern_engine.VARIANTS_BY_ID[variant_id],
                strength=3,
            )
            self.assertTrue(
                all(
                    (point.vibration > 0) == (point.suction > 0)
                    for point in points
                ),
                variant_id,
            )

    def test_alternating_then_synchronized_variant_really_converges(self) -> None:
        variant = pattern_engine.VARIANTS_BY_ID["combined.reward.5"]
        points = pattern_engine.generate_round(variant, strength=3)
        early = [
            point
            for point in points
            if (point.elapsed_seconds * variant.vibration_hz) % 1.0 < 0.60
        ]
        late = [
            point
            for point in points
            if 0.68
            <= (point.elapsed_seconds * variant.vibration_hz) % 1.0
            <= 0.95
        ]
        self.assertTrue(
            any(
                point.vibration != point.suction
                for point in early
            )
        )
        self.assertTrue(
            all(
                point.vibration == point.suction
                for point in late
            )
        )

    def test_alternating_variants_have_more_exclusive_than_shared_activity(self) -> None:
        for variant_id in (
            "combined.tease.3",
            "combined.punishment.1",
        ):
            points = pattern_engine.generate_round(
                pattern_engine.VARIANTS_BY_ID[variant_id],
                strength=3,
            )
            exclusive = sum(
                (point.vibration > 0) != (point.suction > 0)
                for point in points
            )
            shared = sum(
                point.vibration > 0 and point.suction > 0
                for point in points
            )
            self.assertGreater(exclusive, shared, variant_id)


class ShuffleBagTests(unittest.TestCase):
    def test_all_five_variants_are_used_before_repeating(self) -> None:
        bag = pattern_engine.ShuffleBag(random.Random(42))
        first_round = [bag.roll("combined", "tease").id for _ in range(5)]
        second_round = [bag.roll("combined", "tease").id for _ in range(5)]
        self.assertEqual(len(set(first_round)), 5)
        self.assertEqual(len(set(second_round)), 5)
        self.assertNotEqual(first_round[-1], second_round[0])

    def test_groups_keep_independent_histories(self) -> None:
        bag = pattern_engine.ShuffleBag(random.Random(7))
        combined = [bag.roll("combined", "gentle").id for _ in range(3)]
        suction = [bag.roll("suction_only", "gentle").id for _ in range(3)]
        self.assertTrue(all(item.startswith("combined.gentle.") for item in combined))
        self.assertTrue(
            all(item.startswith("suction_only.gentle.") for item in suction)
        )


if __name__ == "__main__":
    unittest.main()
