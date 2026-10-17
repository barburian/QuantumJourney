import importlib.util
import logging

import numpy as np
import pymatching
import pytest
import stim
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from qec_bridge import UnityQNoiseProfile, add_noise, build_dem, decode_bitstrings, simulate, transpile_to_stim
from qec_bridge.decoding import _decoder, _detection_events


def rep(d=3, rounds=3, per_round_regs=True):
    """Bit-flip repetition code (data 0..d-1, ancillas d..2d-2) with fin declared first, so the qiskit clbit order
    differs from the measurement record order; returns (qc, final register, clbits in record order)."""
    q, fin = QuantumRegister(2 * d - 1, "q"), ClassicalRegister(d, "fin")
    syn = [ClassicalRegister(d - 1, f"r{r}") for r in range(rounds)] if per_round_regs else [ClassicalRegister(d - 1)]
    qc, record = QuantumCircuit(q, fin, *syn), []
    for r in range(rounds):
        for i in range(d - 1):
            qc.cx(i, d + i); qc.cx(i + 1, d + i)
        reg = syn[r % len(syn)]
        qc.measure(range(d, 2 * d - 1), reg)
        qc.reset(range(d, 2 * d - 1))
        qc.barrier()
        record += list(reg)
    qc.measure(range(d), fin)
    return qc, fin, record + list(fin)


def scaled(s):
    """UnityQ profile with every error rate multiplied by s."""
    p = UnityQNoiseProfile()
    return UnityQNoiseProfile(f_1q=1 - s * (1 - p.f_1q), f_2q=1 - s * (1 - p.f_2q), f_meas=1 - s * (1 - p.f_meas),
                              p_reset=s * p.p_reset, idle_rate_per_us=s * p.idle_rate_per_us)


def annotated(d=3, **kw):
    qc, fin, record = rep(d, **kw)
    return transpile_to_stim(qc, observables=[[fin[0]]]), qc, record


def test_build_dem_and_simulate_rep3():
    c, _, _ = annotated()
    assert build_dem(add_noise(c)).num_detectors == c.num_detectors
    assert simulate(c, 1000, seed=1) == {"shots": 1000, "per_observable": [0.0], "any": 0.0}
    noisy = add_noise(c, scaled(3))
    r = simulate(noisy, 5000, seed=7)
    assert 0 < r["any"] < 0.1 and r["per_observable"] == [r["any"]]
    assert simulate(noisy, 5000, seed=7) == r


def test_matcher_built_once_per_dem(monkeypatch):
    calls = []
    orig = pymatching.Matching.from_detector_error_model

    def counting(dem):
        calls.append(dem)
        return orig(dem)

    monkeypatch.setattr(pymatching.Matching, "from_detector_error_model", counting)
    _decoder.cache_clear()
    noisy = add_noise(annotated()[0], scaled(3))
    for shots, seed in [(200, 0), (500, 1), (1000, 2)]:
        simulate(noisy, shots, seed=seed)
    assert len(calls) == 1
    _decoder.cache_clear()


def test_distance_5_beats_distance_3():
    rates = [simulate(add_noise(annotated(d)[0], scaled(3)), 20000, seed=11)["any"] for d in (3, 5)]
    assert 0 < rates[1] < 0.75 * rates[0]  # ~0.0096 vs ~0.0195; seeds fixed anyway


def to_qiskit(qc, record, measurements):
    """stim measurement records -> qiskit memory strings ("fin r2 r1 r0", little-endian per register)."""
    pos = {b: i for i, b in enumerate(record)}
    return [" ".join("".join("1" if m[pos[b]] else "0" for b in reversed(reg)) for reg in reversed(qc.cregs))
            for m in measurements]


def test_bitstrings_match_stim_detection_events():
    c, qc, record = annotated()
    noisy = add_noise(c, scaled(3))
    m = noisy.compile_sampler(seed=3).sample(300)
    memory = to_qiskit(qc, record, m)
    assert memory[0].count(" ") == 3 and len(memory[0]) == 3 + 2 * 3 + 3
    dets, obs = _detection_events(c, qc, memory)
    want_dets, want_obs = noisy.compile_m2d_converter().convert(measurements=m, separate_observables=True)
    assert dets.any() and (dets == want_dets).all() and (obs == want_obs).all()

    counts = {}
    for s in memory:
        counts[s] = counts.get(s, 0) + 1
    assert decode_bitstrings(c, qc, counts)["any"] == decode_bitstrings(c, qc, memory)["any"] > 0


def test_noiseless_bitstrings_decode_to_zero_errors():
    c, qc, record = annotated()
    memory = to_qiskit(qc, record, c.compile_sampler(seed=0).sample(100))
    assert decode_bitstrings(c, qc, memory) == {"shots": 100, "per_observable": [0.0], "any": 0.0}
    assert decode_bitstrings(c, qc, {memory[0]: 5})["shots"] == 5


def test_bitstring_errors():
    c, qc, record = annotated()
    memory = to_qiskit(qc, record, c.compile_sampler(seed=0).sample(2))
    with pytest.raises(ValueError, match="bits"):
        decode_bitstrings(c, qc, [memory[0][1:]])
    qc2, fin, _ = rep(per_round_regs=False)
    c2 = transpile_to_stim(qc2, observables=[[fin[0]]])
    with pytest.raises(ValueError, match="more than one measurement"):
        decode_bitstrings(c2, qc2, ["000 00"])


HYPEREDGE = stim.Circuit("""
    R 0 1 2
    E(0.1) X0 X1 X2
    M 0 1 2
    DETECTOR(0, 0, 0) rec[-3]
    DETECTOR(1, 0, 0) rec[-2]
    DETECTOR(2, 0, 0) rec[-1]
    OBSERVABLE_INCLUDE(0) rec[-1]
""")


def test_hyperedge_fallback_logs_and_needs_bp(caplog, monkeypatch):
    with caplog.at_level(logging.WARNING, logger="qec_bridge.decoding"):
        dem = build_dem(HYPEREDGE)
    assert str(dem).startswith("error(0.1) D0 D1 D2 L0")
    assert "ExplainedError" in caplog.text and "D2[coords 2,0,0]" in caplog.text and "E(0.1) X0 X1 X2" in caplog.text
    with monkeypatch.context() as mp:
        mp.setattr(importlib.util, "find_spec", lambda name, *a: None)
        with pytest.raises(ImportError, match="beliefmatching and ldpc"):
            simulate(HYPEREDGE, 10, seed=0)


def test_hyperedge_bposd_decode():
    pytest.importorskip("beliefmatching")
    pytest.importorskip("ldpc")
    r = simulate(HYPEREDGE, 1000, seed=0)
    assert r["any"] < 0.05  # the only error mechanism is fully identifiable from its 3 detectors
