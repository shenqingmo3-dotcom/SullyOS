from __future__ import annotations


KEY_TABLE = (
    (0, 24, 152, 247, 165, 61, 13, 41, 37, 80, 68, 70),
    (0, 69, 110, 106, 111, 120, 32, 83, 45, 49, 46, 55),
    (0, 101, 120, 32, 84, 111, 121, 115, 10, 142, 157, 163),
    (0, 197, 214, 231, 248, 10, 50, 32, 111, 98, 13, 10),
)


def encrypt_payload(payload: list[int]) -> bytes:
    if len(payload) != 10:
        raise ValueError("Galaku payload must contain exactly 10 bytes")
    if any(value < 0 or value > 255 for value in payload):
        raise ValueError("Galaku payload bytes must be between 0 and 255")

    plain = [35, *payload]
    plain.append(sum(plain))
    encrypted = [plain[0]]
    for index in range(1, len(plain)):
        key = KEY_TABLE[encrypted[index - 1] & 3][index]
        value = (key ^ plain[0] ^ plain[index]) + key
        encrypted.append(value & 0xFF)
    return bytes(encrypted)


def control_command(vibration: int, suction: int) -> bytes:
    if not 0 <= vibration <= 100 or not 0 <= suction <= 100:
        raise ValueError("Vibration and suction must be between 0 and 100")
    return encrypt_payload([90, 0, 0, 1, 64, 3, vibration, suction, 0, 0])


STOP_COMMAND = encrypt_payload([80, 0, 0, 1, 23, 0, 0, 0, 0, 0])
