from __future__ import annotations

import math
import random
import threading
from dataclasses import asdict, dataclass
from typing import Iterable


STEP_SECONDS = 0.05
MIN_ACTIVE_INTENSITY = 10

BOARD_LABELS = {
    "suction_only": "仅吮吸",
    "combined": "震动＋吮吸",
}

SCENE_LABELS = {
    "gentle": "温和",
    "tease": "逗弄",
    "reward": "奖励",
    "intense": "强烈",
    "punishment": "惩罚",
}


@dataclass(frozen=True)
class SceneProfile:
    minimum: int
    maximum: int


SCENE_PROFILES = {
    "gentle": SceneProfile(10, 30),
    "tease": SceneProfile(10, 50),
    "reward": SceneProfile(15, 65),
    "intense": SceneProfile(30, 85),
    "punishment": SceneProfile(20, 75),
}


@dataclass(frozen=True)
class Variant:
    id: str
    board: str
    scene: str
    name: str
    description: str
    vibration_shape: str
    suction_shape: str
    vibration_hz: float
    suction_hz: float
    vibration_phase: float = 0.0
    suction_phase: float = 0.0
    vibration_scale: float = 1.0
    suction_scale: float = 1.0
    round_seconds: float = 10.8


@dataclass(frozen=True)
class PatternPoint:
    elapsed_seconds: float
    vibration: int
    suction: int


def _variant(
    board: str,
    scene: str,
    number: int,
    name: str,
    description: str,
    vibration_shape: str,
    suction_shape: str,
    vibration_hz: float,
    suction_hz: float,
    **kwargs: float,
) -> Variant:
    return Variant(
        id=f"{board}.{scene}.{number}",
        board=board,
        scene=scene,
        name=name,
        description=description,
        vibration_shape=vibration_shape,
        suction_shape=suction_shape,
        vibration_hz=vibration_hz,
        suction_hz=suction_hz,
        **kwargs,
    )


VARIANTS = (
    # 仅吮吸：温和
    _variant("suction_only", "gentle", 1, "缓慢呼吸", "缓慢、圆润地吸入和释放", "off", "breath", 0, 0.55),
    _variant("suction_only", "gentle", 2, "柔和爬升", "逐渐增强后轻柔回落", "off", "saw_soft", 0, 0.45),
    _variant("suction_only", "gentle", 3, "轻柔小浪", "低位连续小幅波动", "off", "soft_ripple", 0, 0.85),
    _variant("suction_only", "gentle", 4, "慢升慢降", "对称的慢速三角波", "off", "triangle", 0, 0.42),
    _variant("suction_only", "gentle", 5, "低位循环", "保持低位并带轻微起伏", "off", "soft_hold", 0, 0.65, suction_scale=0.86),
    # 仅吮吸：逗弄
    _variant("suction_only", "tease", 1, "吸停交替", "吸一下，停一下", "off", "single_pulse", 0, 0.72),
    _variant("suction_only", "tease", 2, "双击停顿", "连续两次短吸后停顿", "off", "double_pulse", 0, 0.48),
    _variant("suction_only", "tease", 3, "爬升骤停", "逐渐增强，到峰值后突然释放", "off", "saw_pause", 0, 0.52),
    _variant("suction_only", "tease", 4, "短促轻吸", "一组密集短吸后留出空白", "off", "flutter_pause", 0, 0.46),
    _variant("suction_only", "tease", 5, "假停止", "短暂停止后突然恢复", "off", "false_stop", 0, 0.58),
    # 仅吮吸：奖励
    _variant("suction_only", "reward", 1, "稳定递增", "稳定爬升并柔和回到起点", "off", "saw_soft", 0, 0.62),
    _variant("suction_only", "reward", 2, "双峰波浪", "每轮形成两个圆润峰值", "off", "double_breath", 0, 0.44),
    _variant("suction_only", "reward", 3, "规律阶梯", "分级增强后重新开始", "off", "staircase", 0, 0.52),
    _variant("suction_only", "reward", 4, "舒适循环", "持续而平滑的中速循环", "off", "breath", 0, 0.78),
    _variant("suction_only", "reward", 5, "三段增强", "三次逐步增强组成一轮", "off", "triple_build", 0, 0.38),
    # 仅吮吸：强烈
    _variant("suction_only", "intense", 1, "快速循环", "快速而完整的吸放循环", "off", "breath", 0, 1.35),
    _variant("suction_only", "intense", 2, "高位保持", "高位持续，间隔短暂回落", "off", "high_hold", 0, 0.82),
    _variant("suction_only", "intense", 3, "深浅交替", "深吸和浅吸交替出现", "off", "alternating_depth", 0, 0.78),
    _variant("suction_only", "intense", 4, "密集波浪", "连续的快速三角波", "off", "triangle", 0, 1.65),
    _variant("suction_only", "intense", 5, "冲高回落", "快速冲高，短暂回落后再次增强", "off", "surge", 0, 1.05),
    # 仅吮吸：惩罚
    _variant("suction_only", "punishment", 1, "突然强吸", "无预告的短促强吸", "off", "sharp_burst", 0, 0.62),
    _variant("suction_only", "punishment", 2, "不规则爆发", "长短不一的不规则吸力", "off", "irregular", 0, 0.88),
    _variant("suction_only", "punishment", 3, "长短交错", "长吸、短吸交替", "off", "long_short", 0, 0.58),
    _variant("suction_only", "punishment", 4, "假释放", "看似释放后迅速再次启动", "off", "false_release", 0, 0.66),
    _variant("suction_only", "punishment", 5, "密集短促", "密集脉冲与意外停顿混合", "off", "dense_burst", 0, 1.05),
    # 震动＋吮吸：温和
    _variant("combined", "gentle", 1, "同步呼吸", "两种功能同步缓慢起伏", "breath", "breath", 0.55, 0.55, suction_scale=0.90),
    _variant("combined", "gentle", 2, "震动托底", "低位震动持续，吮吸形成柔和波浪", "soft_hold", "breath", 0.65, 0.52, vibration_scale=0.78),
    _variant("combined", "gentle", 3, "吮吸先行", "吮吸先增强，震动稍后跟随", "breath_delayed", "breath", 0.58, 0.58),
    _variant("combined", "gentle", 4, "柔和交替", "两个通道平滑地轮流增强", "breath", "breath", 0.48, 0.48, suction_phase=0.5),
    _variant("combined", "gentle", 5, "双层慢浪", "两条速度略有不同的慢波叠加", "triangle", "breath", 0.44, 0.56, suction_scale=0.88),
    # 震动＋吮吸：逗弄
    _variant("combined", "tease", 1, "震动先出现", "先震动，随后吮吸跟上", "single_pulse", "single_pulse", 0.64, 0.64, suction_phase=-0.18),
    _variant("combined", "tease", 2, "吮吸先出现", "先吮吸，随后震动跟上", "single_pulse", "single_pulse", 0.62, 0.62, vibration_phase=-0.20),
    _variant("combined", "tease", 3, "轮流启动", "震动和吮吸交替出现", "single_pulse", "single_pulse", 0.72, 0.72, suction_phase=0.5),
    _variant("combined", "tease", 4, "同步骤停", "短暂同步增强后同时停顿", "double_pulse", "double_pulse", 0.46, 0.46),
    _variant("combined", "tease", 5, "故意错拍", "两个通道使用不同速度，持续产生错拍", "triangle", "single_pulse", 0.88, 0.63),
    # 震动＋吮吸：奖励
    _variant("combined", "reward", 1, "同步递增", "两种功能共同递增并平滑回落", "saw_soft", "saw_soft", 0.58, 0.58),
    _variant("combined", "reward", 2, "双峰同步", "每轮形成两次同步峰值", "double_breath", "double_breath", 0.46, 0.46),
    _variant("combined", "reward", 3, "持续与增强", "震动稳定托底，吮吸逐步增强", "soft_hold", "staircase", 0.70, 0.48, vibration_scale=0.90),
    _variant("combined", "reward", 4, "三段共同增强", "两个通道分三段一起提高", "triple_build", "triple_build", 0.38, 0.38),
    _variant("combined", "reward", 5, "交替后同步", "先交替增强，随后汇合到同步峰值", "converge_a", "converge_b", 0.52, 0.52),
    # 震动＋吮吸：强烈
    _variant("combined", "intense", 1, "快速同步", "两个通道快速同步循环", "triangle", "triangle", 1.35, 1.35),
    _variant("combined", "intense", 2, "密震持续吸", "密集震动搭配高位吮吸", "dense_burst", "high_hold", 1.45, 0.78),
    _variant("combined", "intense", 3, "持续震快速吸", "高位震动搭配快速吮吸", "high_hold", "triangle", 0.78, 1.42),
    _variant("combined", "intense", 4, "双通道高位脉冲", "两个通道共同形成高位脉冲", "high_hold", "high_hold", 0.95, 0.95),
    _variant("combined", "intense", 5, "反复冲高", "两个通道以不同速度反复冲高回落", "surge", "surge", 1.10, 0.92, suction_phase=0.16),
    # 震动＋吮吸：惩罚
    _variant("combined", "punishment", 1, "突然交替", "两个通道突然轮流爆发", "sharp_burst", "sharp_burst", 0.72, 0.72, suction_phase=0.25),
    _variant("combined", "punishment", 2, "不规则交叉", "不同的不规则节奏相互穿插", "irregular", "irregular_alt", 0.92, 0.83),
    _variant("combined", "punishment", 3, "短叠长停", "短促共同增强后留下较长停顿", "double_pulse", "double_pulse", 0.40, 0.40),
    _variant("combined", "punishment", 4, "意外叠加", "交替过程中突然同时增强", "crossfire", "crossfire_alt", 0.68, 0.68),
    _variant("combined", "punishment", 5, "假停重启", "两个通道看似停止后突然恢复", "false_stop", "false_release", 0.62, 0.67),
)


VARIANTS_BY_GROUP: dict[tuple[str, str], tuple[Variant, ...]] = {
    (board, scene): tuple(
        variant
        for variant in VARIANTS
        if variant.board == board and variant.scene == scene
    )
    for board in BOARD_LABELS
    for scene in SCENE_LABELS
}

VARIANTS_BY_ID = {variant.id: variant for variant in VARIANTS}


def validate_catalog() -> None:
    if len(VARIANTS) != 50:
        raise RuntimeError(f"Expected 50 variants, found {len(VARIANTS)}")
    if len(VARIANTS_BY_ID) != len(VARIANTS):
        raise RuntimeError("Variant IDs must be unique")
    for key, variants in VARIANTS_BY_GROUP.items():
        if len(variants) != 5:
            raise RuntimeError(f"Expected five variants for {key}, found {len(variants)}")
        if key[0] == "suction_only" and any(
            variant.vibration_shape != "off" for variant in variants
        ):
            raise RuntimeError(f"Suction-only group {key} contains vibration")


validate_catalog()


class ShuffleBag:
    """Thread-safe per-group shuffle bags with no immediate boundary repeat."""

    def __init__(self, rng: random.Random | None = None) -> None:
        self._rng = rng or random.SystemRandom()
        self._bags: dict[tuple[str, str], list[Variant]] = {}
        self._last: dict[tuple[str, str], str] = {}
        self._lock = threading.Lock()

    def roll(self, board: str, scene: str) -> Variant:
        validate_group(board, scene)
        key = (board, scene)
        with self._lock:
            bag = self._bags.get(key)
            if not bag:
                bag = list(VARIANTS_BY_GROUP[key])
                self._rng.shuffle(bag)
                last_id = self._last.get(key)
                if last_id and bag[-1].id == last_id:
                    bag[0], bag[-1] = bag[-1], bag[0]
                self._bags[key] = bag
            variant = bag.pop()
            self._last[key] = variant.id
            return variant

    def clear(self) -> None:
        with self._lock:
            self._bags.clear()
            self._last.clear()


def validate_group(board: str, scene: str) -> None:
    if board not in BOARD_LABELS:
        raise ValueError(f"未知板块：{board}")
    if scene not in SCENE_LABELS:
        raise ValueError(f"未知情景：{scene}")


def validate_strength(strength: int) -> int:
    if isinstance(strength, bool):
        raise ValueError("力度等级必须是 1 到 5 的整数")
    try:
        parsed = int(strength)
    except (TypeError, ValueError) as error:
        raise ValueError("力度等级必须是 1 到 5 的整数") from error
    if parsed < 1 or parsed > 5:
        raise ValueError("力度等级必须在 1 到 5 之间")
    return parsed


def _shape_value(shape: str, phase: float) -> float:
    x = phase % 1.0
    breath = 0.5 - 0.5 * math.cos(2 * math.pi * x)
    triangle = 1.0 - abs(2.0 * x - 1.0)

    if shape == "off":
        return 0.0
    if shape == "breath":
        return breath
    if shape == "breath_delayed":
        if x < 0.18:
            return 0.0
        delayed = (x - 0.18) / 0.82
        return 0.5 - 0.5 * math.cos(2 * math.pi * delayed)
    if shape == "triangle":
        return triangle
    if shape == "saw_soft":
        return x**0.72
    if shape == "soft_ripple":
        return 0.30 + 0.35 * breath + 0.08 * math.sin(6 * math.pi * x)
    if shape == "soft_hold":
        return 0.42 + 0.20 * breath
    if shape == "single_pulse":
        return math.sin(math.pi * x / 0.55) if x < 0.55 else 0.0
    if shape == "double_pulse":
        local = (x * 2.0) % 1.0
        return math.sin(math.pi * local / 0.56) if local < 0.56 else 0.0
    if shape == "saw_pause":
        return (x / 0.72) ** 0.8 if x < 0.72 else 0.0
    if shape == "flutter_pause":
        if x >= 0.68:
            return 0.0
        return 0.35 + 0.65 * (0.5 - 0.5 * math.cos(8 * math.pi * x / 0.68))
    if shape == "false_stop":
        if 0.45 <= x < 0.70:
            return 0.0
        local = x / 0.45 if x < 0.45 else (x - 0.70) / 0.30
        return 0.35 + 0.65 * (0.5 - 0.5 * math.cos(2 * math.pi * local))
    if shape == "double_breath":
        return 0.5 - 0.5 * math.cos(4 * math.pi * x)
    if shape == "staircase":
        return (math.floor(x * 5.0) + 1.0) / 5.0
    if shape == "triple_build":
        local = (x * 3.0) % 1.0
        section = min(2, int(x * 3.0))
        return (0.42 + 0.23 * section) * (0.35 + 0.65 * local)
    if shape == "high_hold":
        return 0.66 + 0.34 * (1.0 if x < 0.72 else triangle)
    if shape == "alternating_depth":
        return (0.45 if int(x * 4.0) % 2 == 0 else 1.0) * (
            0.45 + 0.55 * (0.5 - 0.5 * math.cos(8 * math.pi * x))
        )
    if shape == "surge":
        return min(1.0, (x / 0.58) ** 0.48) if x < 0.70 else 0.22 * breath
    if shape == "sharp_burst":
        if x < 0.18:
            return 1.0
        if 0.48 <= x < 0.62:
            return 0.78
        return 0.0
    if shape == "irregular":
        gate = 0.0 if 0.28 < x < 0.39 or 0.78 < x < 0.88 else 1.0
        return gate * min(
            1.0,
            0.25
            + 0.40 * (0.5 - 0.5 * math.cos(6 * math.pi * x))
            + 0.35 * (0.5 - 0.5 * math.cos(14 * math.pi * x)),
        )
    if shape == "irregular_alt":
        return _shape_value("irregular", x + 0.31)
    if shape == "long_short":
        if x < 0.48:
            return 0.75 + 0.25 * math.sin(math.pi * x / 0.48)
        if 0.62 <= x < 0.76:
            return 1.0
        return 0.0
    if shape == "false_release":
        if x < 0.40:
            return 0.55 + 0.45 * math.sin(math.pi * x / 0.40)
        if x < 0.58:
            return 0.12
        return 0.72 + 0.28 * (0.5 - 0.5 * math.cos(4 * math.pi * (x - 0.58)))
    if shape == "dense_burst":
        gate = 0.0 if 0.72 <= x < 0.90 else 1.0
        return gate * (0.35 + 0.65 * (0.5 - 0.5 * math.cos(10 * math.pi * x)))
    if shape in {"converge_a", "converge_b"}:
        if x < 0.64:
            local = x / 0.64
            if shape == "converge_b":
                local = (local + 0.25) % 1.0
            return 0.20 + 0.65 * (
                0.5 - 0.5 * math.cos(4 * math.pi * local)
            )
        return 0.65 + 0.35 * math.sin(math.pi * (x - 0.64) / 0.36)
    if shape == "crossfire":
        alternating = 1.0 if int(x * 6.0) % 2 == 0 else 0.18
        overlap = 1.0 if 0.76 <= x < 0.90 else 0.0
        return max(alternating, overlap)
    if shape == "crossfire_alt":
        return _shape_value("crossfire", x + 0.5 / 6.0)
    raise ValueError(f"Unknown waveform shape: {shape}")


def _channel_intensity(
    waveform_value: float,
    profile: SceneProfile,
    strength: int,
    scale: float,
) -> int:
    if waveform_value <= 0.015 or scale <= 0:
        return 0
    strength_fraction = 0.20 + 0.80 * (strength - 1) / 4.0
    cap = profile.minimum + (profile.maximum - profile.minimum) * strength_fraction
    scaled_cap = max(MIN_ACTIVE_INTENSITY, min(100.0, cap * scale))
    active_floor = min(MIN_ACTIVE_INTENSITY, scaled_cap)
    intensity = active_floor + max(0.0, min(1.0, waveform_value)) * (
        scaled_cap - active_floor
    )
    return max(MIN_ACTIVE_INTENSITY, min(100, round(intensity)))


def generate_round(
    variant: Variant,
    strength: int,
    step_seconds: float = STEP_SECONDS,
) -> list[PatternPoint]:
    strength = validate_strength(strength)
    if variant.id not in VARIANTS_BY_ID:
        raise ValueError(f"未知变体：{variant.id}")
    if step_seconds <= 0 or step_seconds > 0.5:
        raise ValueError("波形步长必须大于 0 且不超过 0.5 秒")

    profile = SCENE_PROFILES[variant.scene]
    point_count = max(1, round(variant.round_seconds / step_seconds))
    points = []
    for index in range(point_count):
        elapsed = index * step_seconds
        vibration_value = _shape_value(
            variant.vibration_shape,
            elapsed * variant.vibration_hz + variant.vibration_phase,
        )
        suction_value = _shape_value(
            variant.suction_shape,
            elapsed * variant.suction_hz + variant.suction_phase,
        )
        points.append(
            PatternPoint(
                elapsed_seconds=round(elapsed, 3),
                vibration=_channel_intensity(
                    vibration_value,
                    profile,
                    strength,
                    variant.vibration_scale,
                ),
                suction=_channel_intensity(
                    suction_value,
                    profile,
                    strength,
                    variant.suction_scale,
                ),
            )
        )
    return points


def catalog_summary() -> dict[str, object]:
    groups = []
    for board, board_label in BOARD_LABELS.items():
        for scene, scene_label in SCENE_LABELS.items():
            groups.append(
                {
                    "board": board,
                    "boardLabel": board_label,
                    "scene": scene,
                    "sceneLabel": scene_label,
                    "variants": [
                        {
                            "id": variant.id,
                            "name": variant.name,
                            "description": variant.description,
                        }
                        for variant in VARIANTS_BY_GROUP[(board, scene)]
                    ],
                }
            )
    return {"variantCount": len(VARIANTS), "groups": groups}


def describe_variant(variant: Variant) -> dict[str, object]:
    data = asdict(variant)
    data["boardLabel"] = BOARD_LABELS[variant.board]
    data["sceneLabel"] = SCENE_LABELS[variant.scene]
    return data


def peak_intensities(points: Iterable[PatternPoint]) -> tuple[int, int]:
    materialized = list(points)
    return (
        max((point.vibration for point in materialized), default=0),
        max((point.suction for point in materialized), default=0),
    )
