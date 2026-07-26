"""
Imports the randomizer. Upstream is a desktop application that reads data files
relative to the process working directory and imports a native BPS library with
no wasm build. Both are handled here so the rest of the package can just call
into it.
"""

from __future__ import annotations

import contextlib
import os
import sys
import types
import warnings
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType

WORKSPACE = Path(__file__).resolve().parents[2]
VENDOR_ROOT = WORKSPACE / "python" / "vendor" / "alttp-door-randomizer"
VENDOR_REVISION = "b55727f0bf56d13493aacc16a55a4c9bcd3c2cde"


def _unavailable(*_args: object, **_kwargs: object) -> None:
    raise RuntimeError("native BPS and LocalRom operations are outside the reference harness")


def _install_bps_import_boundary() -> None:
    if "bps" in sys.modules:
        return
    package = types.ModuleType("bps")
    package.__path__ = []  # type: ignore[attr-defined]
    apply_module = types.ModuleType("bps.apply")
    io_module = types.ModuleType("bps.io")
    apply_module.apply_to_bytearrays = _unavailable  # type: ignore[attr-defined]
    io_module.read_bps = _unavailable  # type: ignore[attr-defined]
    package.apply = apply_module  # type: ignore[attr-defined]
    package.io = io_module  # type: ignore[attr-defined]
    sys.modules.update({"bps": package, "bps.apply": apply_module, "bps.io": io_module})


@contextlib.contextmanager
def vendor_working_directory() -> Iterator[None]:
    previous = Path.cwd()
    os.chdir(VENDOR_ROOT)
    try:
        yield
    finally:
        os.chdir(previous)


@dataclass(frozen=True, slots=True)
class UpstreamModules:
    cli: ModuleType
    fill: ModuleType
    item_list: ModuleType
    items: ModuleType
    main: ModuleType
    race_random: ModuleType
    rom: ModuleType
    text: ModuleType
    babel_fish: type


@lru_cache(maxsize=1)
def load_upstream() -> UpstreamModules:
    vendor_path = str(VENDOR_ROOT)
    if vendor_path not in sys.path:
        sys.path.insert(0, vendor_path)
    _install_bps_import_boundary()

    with vendor_working_directory(), warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=SyntaxWarning, module=r"Text")
        # isort: off
        import CLI  # type: ignore[import-not-found]
        import Fill  # type: ignore[import-not-found]
        import ItemList  # type: ignore[import-not-found]
        import Items  # type: ignore[import-not-found]
        import Main  # type: ignore[import-not-found]
        import RaceRandom  # type: ignore[import-not-found]
        import Text  # type: ignore[import-not-found]
        from source.classes.BabelFish import BabelFish  # type: ignore[import-not-found]

        import Rom  # type: ignore[import-not-found]
        # isort: on

    return UpstreamModules(
        cli=CLI,
        fill=Fill,
        item_list=ItemList,
        items=Items,
        main=Main,
        race_random=RaceRandom,
        rom=Rom,
        text=Text,
        babel_fish=BabelFish,
    )
