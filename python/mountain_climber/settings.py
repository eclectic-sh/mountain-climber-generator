"""Loads the preset and refuses anything the generator has not been tested against."""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .protocol import SETTINGS_VERSION, Mode

WORKSPACE = Path(__file__).resolve().parents[2]
PRESET_PATH = WORKSPACE / "presets" / "mountain-climber.json"

# Changing any value below changes what the generator produces for a given seed.
REQUIRED_VALUES: dict[str, Any] = {
    "antiSelfLock": {"enabled": True, "preserveStartingInventory": True},
    "pseudoBootsReachability": {"enabled": True, "preserveNonAdvancement": True},
}
PSEUDO_BOOTS_SAVE_FLAG = 0x7EF3F1


@lru_cache(maxsize=1)
def _preset() -> dict[str, Any]:
    value = json.loads(PRESET_PATH.read_text(encoding="utf-8"))
    if value.get("schemaVersion") != 1:
        raise RuntimeError("unsupported preset schema")
    if value.get("settingsVersion") != SETTINGS_VERSION:
        raise RuntimeError("preset settings version does not match the protocol")
    if set(value.get("modes", {})) != {"mountain-climber", "mountain-climber-ex"}:
        raise RuntimeError("preset must define exactly both supported modes")
    for key, expected in REQUIRED_VALUES.items():
        if value.get(key) != expected:
            raise RuntimeError(f"preset {key} is not a supported configuration")
    if value.get("pseudoBoots", {}).get("saveFlag") != PSEUDO_BOOTS_SAVE_FLAG:
        raise RuntimeError("preset Pseudo Boots save flag is not supported")
    return value


def settings_for_mode(mode: Mode) -> dict[str, Any]:
    value = _preset()
    settings = copy.deepcopy(value["settings"])
    settings.update(value["modes"][mode])
    return settings


def item_code_overrides() -> dict[str, int]:
    return copy.deepcopy(_preset()["itemCodeOverrides"])


def item_pool_substitution() -> dict[str, Any]:
    return copy.deepcopy(_preset()["itemPoolSubstitution"])


def pseudo_boots_config() -> dict[str, Any]:
    return copy.deepcopy(_preset()["pseudoBoots"])
