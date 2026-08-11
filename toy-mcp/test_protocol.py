import unittest

import galaku_protocol


class GalakuProtocolTests(unittest.TestCase):
    def test_known_single_channel_vector(self) -> None:
        command = galaku_protocol.encrypt_payload([90, 0, 0, 1, 49, 0, 0, 0, 0, 0])
        self.assertEqual(
            command.hex(" "),
            "23 81 bb ab d2 ec 3b 23 bb a3 3b 90",
        )

    def test_verified_vibration_10_percent_vector(self) -> None:
        self.assertEqual(
            galaku_protocol.control_command(10, 0).hex(" "),
            "23 81 bb ab d2 7b 44 29 3b a3 3b ec",
        )

    def test_verified_suction_10_percent_vector(self) -> None:
        self.assertEqual(
            galaku_protocol.control_command(0, 10).hex(" "),
            "23 81 bb ab d2 7b 44 33 b5 43 3b ec",
        )

    def test_official_stop_vector(self) -> None:
        self.assertEqual(
            galaku_protocol.STOP_COMMAND.hex(" "),
            "23 7b cb ab d2 ca d3 23 bb a3 3b ac",
        )

    def test_control_values_must_be_in_range(self) -> None:
        with self.assertRaises(ValueError):
            galaku_protocol.control_command(-1, 0)
        with self.assertRaises(ValueError):
            galaku_protocol.control_command(0, 101)


if __name__ == "__main__":
    unittest.main()
