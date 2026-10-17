"""Phase 3b: inline Pauli noise (UnityQ profile or an Aer NoiseModel) with duration-aware idle noise."""
from dataclasses import dataclass

import numpy as np
import stim

from .detectors import ANNOTATIONS
from .transpiler import GATES

PRE = {"M": "X_ERROR", "MR": "X_ERROR", "MX": "Z_ERROR", "MRX": "Z_ERROR"}  # flip just before readout
RESET = {"R": "X_ERROR", "MR": "X_ERROR", "RX": "Z_ERROR", "MRX": "Z_ERROR"}  # flip just after reset


@dataclass
class UnityQNoiseProfile:
    """Equal1 UnityQ 22FDX benchmark numbers; fields marked PLACEHOLDER are not from the benchmarks."""
    f_1q: float = 0.999
    t_1q_ns: float = 140
    f_2q: float = 0.993
    t_2q_ns: float = 200
    f_meas: float = 0.990
    t_meas_ns: float = 10_000
    p_reset: float = 0.001  # PLACEHOLDER
    t_reset_ns: float = 1_000  # PLACEHOLDER
    idle_rate_per_us: float = 1e-4  # PLACEHOLDER: DEPOLARIZE1 probability per us of idling
    gate_channels: dict = None  # stim gate -> (channel, args); overrides the fidelities (from_noise_model)

    @property
    def p_1q(self):
        return 1.5 * (1 - self.f_1q)

    @property
    def p_2q(self):
        return 1.25 * (1 - self.f_2q)

    @property
    def p_meas(self):
        return 1 - self.f_meas

    def channel(self, gate, n):
        if self.gate_channels is not None:
            return self.gate_channels.get(gate)
        return ("DEPOLARIZE1", [self.p_1q]) if n == 1 else ("DEPOLARIZE2", [self.p_2q])

    @classmethod
    def from_noise_model(cls, noise_model, **kwargs):
        """Profile from a qiskit_aer NoiseModel's all-qubit Pauli errors and symmetric readout error.

        No idle noise unless idle_rate_per_us is passed. Non-Pauli, per-qubit or asymmetric readout errors raise
        NotImplementedError.
        """
        from qiskit.quantum_info import Chi  # qiskit_aer stays optional: only its NoiseModel object is touched

        if noise_model._local_quantum_errors or noise_model._local_readout_errors:
            raise NotImplementedError("per-qubit noise is not supported, use add_all_qubit_* errors")
        channels, p_reset = {}, 0.0
        for name, err in noise_model._default_quantum_errors.items():
            if name not in GATES:
                raise NotImplementedError(f"noise on {name!r} has no stim counterpart")
            chi = Chi(err).data / 2 ** err.num_qubits
            if not np.allclose(chi, np.diag(np.diag(chi))):
                raise NotImplementedError(f"non-Pauli error on {name!r}")
            probs = np.real(np.diag(chi)).reshape([4] * err.num_qubits).T.flatten()[1:]  # stim: first target first
            if name == "reset":
                p_reset = probs[0] + probs[1]  # X or Y after R flips |0>
            elif np.allclose(probs, probs[0]):
                channels[GATES[name]] = (f"DEPOLARIZE{err.num_qubits}", [float(probs.sum())])
            else:
                channels[GATES[name]] = (f"PAULI_CHANNEL_{err.num_qubits}", [float(p) for p in probs])
        f_meas = 1.0
        ro = noise_model._default_readout_error
        if ro is not None:
            (p00, p01), (p10, p11) = ro.probabilities
            if not np.isclose(p01, p10):
                raise NotImplementedError("asymmetric readout error")
            f_meas = 1 - p01
        return cls(**{"f_meas": f_meas, "p_reset": p_reset, "idle_rate_per_us": 0.0, "gate_channels": channels,
                      **kwargs})


def add_noise(circuit, profile=None):
    """Noisy copy of a noiseless stim.Circuit; REPEAT bodies are processed recursively.

    The pass ASAP-layers the ops (TICK and REPEAT boundaries act as barriers; measurements, feedback and
    annotations keep their record order) and ends each layer that takes time with a TICK. Each layer lasts as long
    as its slowest op; every qubit idles for the rest of it and gets DEPOLARIZE1(idle_rate_per_us * idle_us).
    Feedback (CX rec q) is treated as a noiseless, instantaneous frame update.
    """
    return _noisy(circuit, profile or UnityQNoiseProfile(), circuit.num_qubits)


def _pieces(inst, p):
    """Split an instruction into (name, targets, args, qubits, duration_ns, records) units on disjoint qubits."""
    name, ts, args = inst.name, inst.targets_copy(), inst.gate_args_copy()
    if name in ANNOTATIONS:
        return [(name, ts, args, [], 0, True)]
    if any(t.is_measurement_record_target for t in ts):  # classical feedback
        return [(name, ts, args, [t.value for t in ts if t.is_qubit_target], 0, True)]
    data = stim.gate_data(name)
    if name in PRE or name in RESET:
        dur = (p.t_meas_ns if name in PRE else 0) + (p.t_reset_ns if name in RESET else 0)
        return [(name, [t], args, [t.value], dur, name in PRE) for t in ts]
    if not data.is_unitary:
        raise NotImplementedError(f"cannot add noise around {name}")
    k, dur = (2, p.t_2q_ns) if data.is_two_qubit_gate else (1, p.t_1q_ns)
    return [(name, ts[i:i + k], args, [t.value for t in ts[i:i + k]], dur, False) for i in range(0, len(ts), k)]


def _noisy(circuit, p, n):
    out, layers = stim.Circuit(), []
    free, floor, rec = {}, 0, 0

    def flush():
        for layer in layers:
            _emit(layer, p, n, out)
        layers.clear()
        free.clear()

    for inst in circuit:
        if isinstance(inst, stim.CircuitRepeatBlock):
            flush()
            floor = rec = 0
            out.append(stim.CircuitRepeatBlock(inst.repeat_count, _noisy(inst.body_copy(), p, n)))
            continue
        if inst.name == "TICK":
            floor = len(layers)
            continue
        for piece in _pieces(inst, p):
            layer = max([floor] + [free.get(q, 0) for q in piece[3]])
            if piece[5]:
                layer = rec = max(layer, rec)
            for q in piece[3]:
                free[q] = layer + 1
            layers.extend([] for _ in range(layer + 1 - len(layers)))
            layers[layer].append(piece)
    flush()
    return out


def _emit(layer, p, n, out):
    busy = {q: piece[4] for piece in layer for q in piece[3]}
    length = max(busy.values(), default=0)
    for name, ts, *_ in layer:
        if name in PRE and p.p_meas:
            out.append(PRE[name], ts, p.p_meas)
    for name, ts, args, *_ in layer:
        out.append(name, ts, args)
    for name, ts, _, qs, _, records in layer:
        if name in RESET:
            if p.p_reset:
                out.append(RESET[name], ts, p.p_reset)
        elif not records:  # unitary gate
            ch = p.channel(name, len(qs))
            if ch is not None:
                out.append(ch[0], ts, ch[1])
    idle = {}
    for q in range(n):
        if length > busy.get(q, 0) and p.idle_rate_per_us:
            idle.setdefault(p.idle_rate_per_us * (length - busy.get(q, 0)) / 1000, []).append(q)
    for prob, qs in idle.items():
        out.append("DEPOLARIZE1", qs, prob)
    if length:
        out.append("TICK")
