"""Phase 3a: DETECTOR / OBSERVABLE_INCLUDE annotation, declarative (qiskit-qec style) or inferred from flows."""
import warnings

import numpy as np
import stim
from qiskit.circuit import Clbit

ANNOTATIONS = {"TICK", "QUBIT_COORDS", "SHIFT_COORDS", "DETECTOR", "OBSERVABLE_INCLUDE"}


class DetectorCompletenessWarning(UserWarning):
    """num_detectors + num_observables != count_determined_measurements()."""


def _clbits(entry):
    return entry["clbits"] if isinstance(entry, dict) else entry


def _xy(qcoords, q):
    """First two QUBIT_COORDS of q (zero padded); (q, 0) when q has no coords."""
    return (list(qcoords[q]) + [0, 0])[:2] if q in qcoords else [q, 0]


def _append(circuit, name, rec_idx, args):
    n = circuit.num_measurements
    circuit.append(name, [stim.target_rec(i - n) for i in sorted(rec_idx)], args)


def annotate(t, detectors=None, observables=None):
    """Append DETECTOR/OBSERVABLE_INCLUDE to t.circuit (a StimTranspiler) and return the annotated copy.

    Entries are lists of clbits (Clbit or flat int) or dicts {"clbits", "qubits", "time"}; each clbit resolves to
    its latest measurement. A dict detector gets DETECTOR(x, y, time) with (x, y) the mean QUBIT_COORDS of its
    "qubits" (absolute, i.e. SHIFT_COORDS are undone). detectors=None infers them (see infer_detectors).
    """
    def rec(entry):
        idx = set()
        for b in _clbits(entry):
            i = t.clbit_map[b] if isinstance(b, Clbit) else b
            t._rec(i)  # ValueError if never measured
            idx ^= {t.latest_clbit_meas_idx[i]}
        return idx

    c = t.circuit.copy()
    obs = [rec(o) for o in observables or []]
    # SHIFT_COORDS from REPEAT blocks are added to every later DETECTOR; read the total off a probe detector.
    probe = c.copy()
    probe.append("DETECTOR", [], [0, 0, 0])
    shift = np.array(probe.get_detector_coordinates([probe.num_detectors - 1])[probe.num_detectors - 1])
    qcoords = c.get_final_qubit_coordinates()
    if detectors is None:
        dets = infer_detectors(c, obs)
    else:
        dets = []
        for d in detectors:
            d = d if isinstance(d, dict) else {"clbits": d}
            qs = [t.qubit_map.get(q, q) for q in d.get("qubits", [])]
            xy = np.mean([_xy(qcoords, q) for q in qs], axis=0) if qs else [0, 0]
            dets.append((rec(d), [*xy, d.get("time", 0)]))
    for idx, coords in dets:
        _append(c, "DETECTOR", idx, list(np.asarray(coords, dtype=float) - shift))
    for i, idx in enumerate(obs):
        _append(c, "OBSERVABLE_INCLUDE", idx, [i])
    check_detectors(c)
    return c


def check_detectors(circuit):
    """Warn on an incomplete detector set; raise (via stim) if any detector/observable is non-deterministic."""
    n, want = circuit.num_detectors + circuit.num_observables, circuit.count_determined_measurements()
    if n != want:
        warnings.warn(f"{circuit.num_detectors} detectors + {circuit.num_observables} observables = {n}, but "
                      f"{want} measurements are determined", DetectorCompletenessWarning, stacklevel=3)
    circuit.detector_error_model()


def infer_detectors(circuit, observables=()):
    """[(measurement indices, (x, y, round))] -- one local deterministic set per determined measurement.

    For measurement k on qubit q, solve the flow `1 -> Z_q` just before k on the shortest window ending at k that
    starts in an arbitrary state; the solution plus k is a detector. Shortest window = the latest measurements
    that pin Z_q down, e.g. the previous round of the same ancilla, or the last ancilla round for a final data
    readout. The |0> initial state enters as virtual Z measurements prepended to the circuit (dropped from the
    result); qubits measured later (data) come first, so windows can know the ancilla prep but not the data.
    Pivots (latest measurement) of the observables are skipped, so detectors + observables stay independent.
    """
    ops, meas = [], []  # meas[j] = (op position of real measurement j, qubit)
    for inst in circuit.flattened():
        if inst.name in ANNOTATIONS:
            continue
        if inst.name == "M":
            for tgt in inst.targets_copy():
                meas.append((len(ops), tgt.value))
                ops.append(stim.CircuitInstruction("M", [tgt]))
        elif inst.name in ("MR", "MX", "MY", "MRX", "MRY", "MPP"):
            raise NotImplementedError(f"detector inference only handles M, not {inst.name}")
        else:
            ops.append(inst)
    first = {}
    for j, (_, q) in enumerate(meas):
        first.setdefault(q, j)
    virtual = sorted(range(circuit.num_qubits), key=lambda q: -first.get(q, len(meas)))
    nv = len(virtual)
    ops = [stim.CircuitInstruction("M", [q]) for q in virtual] + ops

    skip = {}
    for o in observables:
        o = set(o)
        while o and max(o) in skip:
            o ^= skip[max(o)]
        if o:
            skip[max(o)] = o

    qcoords, rounds, out = circuit.get_final_qubit_coordinates(), {}, []
    for k, (pos, q) in enumerate(meas):
        r = rounds[q] = rounds.get(q, -1) + 1
        if k in skip:
            continue
        pos += nv
        m_before = nv + k  # measurements in ops[:pos]
        for s in range(pos, -1, -1):  # ponytail: linear window scan, O(window) solves per measurement
            window = stim.Circuit()
            for op in ops[s:pos]:
                window.append(op)
            try:
                (sol,) = window.solve_flow_measurements([stim.Flow(f"1 -> Z{q}")])
            except ValueError:  # feedback reaching before the window start
                continue
            if sol is not None:
                offset = m_before - window.num_measurements  # record index of the window's first measurement
                out.append(({k} | {i + offset - nv for i in sol if i + offset >= nv}, (*_xy(qcoords, q), r)))
                break
    return out
