"""The generate request, and the rules for what counts as a valid one."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Mode = Literal["mountain-climber", "mountain-climber-ex"]
SETTINGS_VERSION = "mountain-climber-v0.81"
MAX_SEED = 999_999_999


class ProtocolError(ValueError):
    """Raised when a request or upstream result violates the protocol."""


@dataclass(frozen=True, slots=True)
class GenerateRequest:
    schema_version: int
    mode: Mode
    seed: int
    race: bool
    settings_version: str

    @classmethod
    def from_dict(cls, value: Any) -> GenerateRequest:
        if not isinstance(value, dict):
            raise ProtocolError("request must be an object")

        expected = {"schemaVersion", "mode", "seed", "race", "settingsVersion"}
        unknown = set(value) - expected
        missing = expected - set(value)
        if unknown:
            raise ProtocolError(f"unknown request fields: {sorted(unknown)}")
        if missing:
            raise ProtocolError(f"missing request fields: {sorted(missing)}")

        if value["schemaVersion"] != 1:
            raise ProtocolError("schemaVersion must be 1")
        if value["mode"] not in ("mountain-climber", "mountain-climber-ex"):
            raise ProtocolError("unsupported mode")
        if isinstance(value["seed"], bool) or not isinstance(value["seed"], int):
            raise ProtocolError("seed must be an integer")
        if not 0 <= value["seed"] <= MAX_SEED:
            raise ProtocolError(f"seed must be between 0 and {MAX_SEED}")
        if not isinstance(value["race"], bool):
            raise ProtocolError("race must be a boolean")
        if value["settingsVersion"] != SETTINGS_VERSION:
            raise ProtocolError(f"settingsVersion must be {SETTINGS_VERSION}")

        return cls(
            schema_version=1,
            mode=value["mode"],
            seed=value["seed"],
            race=value["race"],
            settings_version=value["settingsVersion"],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "mode": self.mode,
            "seed": self.seed,
            "race": self.race,
            "settingsVersion": self.settings_version,
        }
