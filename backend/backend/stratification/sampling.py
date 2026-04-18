"""Deterministic seeded stratified sampling.

Same (scan_id, stratum, n, seed) → same picks. Exclusions honored.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass


@dataclass
class DocRow:
    source_sha256: str
    source_path: str
    source_format: str
    size_bytes: int
    page_count: int | None


def default_seed(scan_id: str) -> int:
    """Integer seed derived from scan_id when caller didn't provide one."""
    h = hashlib.sha256(scan_id.encode("utf-8")).digest()
    # 63-bit unsigned for safety across serializations
    return int.from_bytes(h[:8], "big") & ((1 << 63) - 1)


def pick_sample(
    docs: list[DocRow],
    *,
    n: int,
    seed: int,
    stratum_name: str,
    exclude_hashes: set[str],
) -> list[DocRow]:
    """Return up to `n` docs deterministically.

    - Sort by source_sha256 for stable input order (DB rows arrive unordered)
    - Apply exclusion
    - If size ≤ n → return all
    - Otherwise Fisher-Yates-ish shuffle with (seed, stratum_name)-keyed RNG
      and slice the first `n`
    """
    pool = sorted(
        (d for d in docs if d.source_sha256 not in exclude_hashes),
        key=lambda d: d.source_sha256,
    )
    if len(pool) <= n:
        return pool

    # Stream the stratum name into the seed so different strata in the same
    # SampleRequest pick independently even when they share the top-level seed.
    rng_seed = seed ^ int.from_bytes(
        hashlib.sha256(stratum_name.encode("utf-8")).digest()[:8], "big"
    )
    rng = random.Random(rng_seed)
    shuffled = pool[:]
    rng.shuffle(shuffled)
    return shuffled[:n]
