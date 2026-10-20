"""Phase 4: detector error models, cached MWPM decoding, Monte Carlo and hardware-bitstring logical error rates."""
import importlib.util
import logging
from functools import lru_cache
from types import SimpleNamespace

import numpy as np
import pymatching
import stim

from .noise import add_noise
from .transpiler import StimTranspiler

log = logging.getLogger(__name__)


def build_dem(circuit):
    """Graphlike DEM for matching; falls back to the undecomposed DEM (logging the culprits) on hyperedges."""
    try:
        return circuit.detector_error_model(decompose_errors=True, approximate_disjoint_errors=True)
    except ValueError as e:
        dem = circuit.detector_error_model(approximate_disjoint_errors=True)
        bad = stim.DetectorErrorModel()
        for inst in dem.flattened():
            if inst.type == "error" and _max_symptoms(inst) > 2:
                bad.append(inst)
        explained = circuit.explain_detector_error_model_errors(dem_filter=bad, reduce_to_one_representative_error=True)
        log.warning("%s\nfalling back to a hyperedge decoder for:\n%s", e, "\n".join(map(str, explained)))
        return dem


def _max_symptoms(inst):
    """Most detectors in any ^-separated component of a DEM error instruction."""
    n = best = 0
    for t in inst.targets_copy():
        if t.is_separator():
            n = 0
        elif t.is_relative_detector_id():
            n += 1
            best = max(best, n)
    return best


@lru_cache(maxsize=None)
def _decoder(dem_text):
    """Cached on the DEM text, so a sweep over shots/seeds of one noisy circuit builds the decoder once."""
    dem = stim.DetectorErrorModel(dem_text)
    if any(inst.type == "error" and _max_symptoms(inst) > 2 for inst in dem.flattened()):
        return _bposd(dem)  # pymatching would silently mangle the hyperedges
    return pymatching.Matching.from_detector_error_model(dem)


def _bposd(dem):
    """BP-OSD decoder with pymatching's decode_batch interface, for hyperedge DEMs; needs beliefmatching + ldpc."""
    missing = [m for m in ("beliefmatching", "ldpc") if importlib.util.find_spec(m) is None]
    if missing:
        raise ImportError(f"the DEM has undecomposable hyperedges; decoding it needs {' and '.join(missing)} "
                          f"(pip install {' '.join(missing)})")
    from beliefmatching import detector_error_model_to_check_matrices
    from ldpc import BpOsdDecoder

    m = detector_error_model_to_check_matrices(dem, allow_undecomposed_hyperedges=True)
    bp = BpOsdDecoder(m.check_matrix, error_channel=list(m.priors), max_iter=m.check_matrix.shape[1],
                      bp_method="minimum_sum", osd_method="osd_cs", osd_order=7)
    obs = m.observables_matrix
    # ponytail: one BP-OSD call per shot in Python; fine for tests, batch/sinter if throughput matters
    return SimpleNamespace(decode_batch=lambda dets: np.array([obs @ bp.decode(d) % 2 for d in dets], dtype=np.uint8)
                           .reshape(len(dets), obs.shape[0]))


def _rates(decoder, dets, obs):
    """Decode detection events and compare with the true observable flips -> logical error rates."""
    errors = decoder.decode_batch(dets).astype(bool) != obs
    return {"shots": len(obs), "per_observable": errors.mean(axis=0).tolist(), "any": float(errors.any(axis=1).mean())}


def simulate(circuit, shots, seed=None):
    """Logical error rates of a noisy annotated circuit: {"shots", "per_observable": [rate], "any": rate}."""
    dets, obs = circuit.compile_detector_sampler(seed=seed).sample(shots, separate_observables=True)
    return _rates(_decoder(str(build_dem(circuit))), dets, obs)


def _measurements(circuit, qc, counts_or_memory):
    """Qiskit memory list or counts dict -> (shots, num_measurements) bools in stim record order."""
    t = StimTranspiler(qc)
    label_to_clbit = {v: k for k, v in t.clbit_label.items()}
    meas = [label_to_clbit.get(m, m) for m in t.measurement_data]  # record index -> flat clbit int
    if len(set(meas)) != len(meas):
        raise ValueError("a clbit is written by more than one measurement (register reused across rounds?); "
                         "use one ClassicalRegister per round")
    if len(meas) != circuit.num_measurements:
        raise ValueError(f"qc makes {len(meas)} measurements but the stim circuit makes {circuit.num_measurements}")
    bit = {c: b for b, c in t.clbit_map.items()}
    cols = [qc.find_bit(bit[c]).index for c in meas]
    shots = counts_or_memory.items() if isinstance(counts_or_memory, dict) else ((s, 1) for s in counts_or_memory)
    rows = []
    for s, n in shots:
        s = s.replace(" ", "")[::-1]  # little-endian, last register first => s[i] is qc.clbits[i]
        if len(s) != qc.num_clbits:
            raise ValueError(f"bitstring {s[::-1]!r} has {len(s)} bits, qc has {qc.num_clbits} clbits")
        rows += [[s[i] == "1" for i in cols]] * n
    return np.array(rows, dtype=bool).reshape(len(rows), len(cols))


def _detection_events(circuit, qc, counts_or_memory):
    """Qiskit results -> (detection events, observable flips) via stim's measurement-to-detection converter."""
    m = _measurements(circuit, qc, counts_or_memory)
    return circuit.compile_m2d_converter().convert(measurements=m, separate_observables=True)


def decode_bitstrings(circuit, qc, counts_or_memory, dem=None):
    """Logical error rates (as simulate) of Qiskit results for qc, given its annotated stim translation.

    counts_or_memory: memory list ["fin r1 r0", ...] or counts {"fin r1 r0": n}. dem is the decoder's noise prior,
    by default build_dem(add_noise(circuit)) i.e. the UnityQ profile.
    """
    dets, obs = _detection_events(circuit, qc, counts_or_memory)
    return _rates(_decoder(str(dem if dem is not None else build_dem(add_noise(circuit)))), dets, obs)
