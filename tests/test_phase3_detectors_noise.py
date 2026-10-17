import warnings

import pytest
import stim
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from qec_bridge import DetectorCompletenessWarning, UnityQNoiseProfile, add_noise, transpile_to_stim
from test_phase1_transpiler import loop_with_pre_measurement, rep_code

DATA, ANC = (0, 1, 2), (3, 4)  # ancilla 3 checks Z0Z1, ancilla 4 checks Z1Z2
COORDS = {0: (0, 0), 1: (2, 0), 2: (4, 0), 3: (1, 0), 4: (3, 0)}


def rep3(looped=True, feedback=False, flip=False, per_round_regs=False):
    """d=3, 3-round bit-flip repetition code, unannotated; returns (qc, syndrome registers, final register)."""
    q, fin = QuantumRegister(5, "q"), ClassicalRegister(3, "fin")
    syn = [ClassicalRegister(2, f"r{r}") for r in range(3)] if per_round_regs else [ClassicalRegister(2, "syn")]
    qc = QuantumCircuit(q, *syn, fin)
    if flip:
        qc.x(0)

    def rnd(reg):
        qc.cx(0, 3); qc.cx(1, 4); qc.cx(1, 3); qc.cx(2, 4)
        qc.measure(ANC, reg)
        if feedback:
            for i, a in enumerate(ANC):
                with qc.if_test((reg[i], 1)):
                    qc.x(a)
        else:
            qc.reset(ANC)
        qc.barrier()

    if looped:
        with qc.for_loop(range(3)):
            rnd(syn[0])
    else:
        for r in range(3):
            rnd(syn[r % len(syn)])
    qc.measure(DATA, fin)
    return qc, syn, fin


def measured_qubits(c):
    return [t.value for inst in c.flattened() if inst.name == "M" for t in inst.targets_copy()]


def detector_sets(c):
    n, out = c.num_measurements, []
    for inst in c.flattened():
        if inst.name == "DETECTOR":
            out.append(sorted(n + t.value for t in inst.targets_copy()))
    return out


@pytest.mark.parametrize("kw", [{}, {"looped": False}, {"feedback": True}, {"flip": True}])
def test_inferred_detectors_are_complete_local_and_deterministic(kw):
    qc, _, fin = rep3(**kw)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        c = transpile_to_stim(qc, observables=[[fin[0]]])
    assert c.num_detectors + c.num_observables == c.count_determined_measurements() == 9
    c.detector_error_model()
    qubits = measured_qubits(c)
    for det in detector_sets(c):
        anc = [qubits[i] for i in det if qubits[i] in ANC]
        data = [qubits[i] for i in det if qubits[i] in DATA]
        assert len(anc) <= 2 and len(set(anc)) == 1
        if data:  # boundary: last round of one ancilla vs the two data qubits it checks
            assert len(anc) == 1 and sorted(data) == [anc[0] - 3, anc[0] - 2] and det[0] in (4, 5)
        elif len(anc) == 2:  # consecutive rounds of the same ancilla
            assert det[1] - det[0] == 2
    assert not c.compile_detector_sampler().sample(50).any()


def test_observables_are_never_guessed():
    qc, _, _ = rep3()
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        c = transpile_to_stim(qc, observables=[])
    assert (c.num_detectors, c.num_observables) == (9, 0)  # Z0 vs prep becomes a detector, not an observable


def declarative(qc_regs):
    _, syn, fin = qc_regs
    dets = [{"clbits": [syn[0][i]], "qubits": [i, i + 1], "time": 0} for i in range(2)]
    dets += [{"clbits": [syn[r][i], syn[r - 1][i]], "qubits": [i, i + 1], "time": r} for r in (1, 2) for i in range(2)]
    dets += [{"clbits": [syn[2][i], fin[i], fin[i + 1]], "qubits": [i, i + 1], "time": 3} for i in range(2)]
    return dets, [[fin[0]]]


DECLARATIVE = """
DETECTOR(1, 0, 0) rec[-9]
DETECTOR(3, 0, 0) rec[-8]
DETECTOR(1, 0, 1) rec[-9] rec[-7]
DETECTOR(3, 0, 1) rec[-8] rec[-6]
DETECTOR(1, 0, 2) rec[-7] rec[-5]
DETECTOR(3, 0, 2) rec[-6] rec[-4]
DETECTOR(1, 0, 3) rec[-5] rec[-3] rec[-2]
DETECTOR(3, 0, 3) rec[-4] rec[-2] rec[-1]
OBSERVABLE_INCLUDE(0) rec[-3]
"""


def test_declarative_dicts_match_hand_written():
    regs = rep3(looped=False, per_round_regs=True, flip=True)
    dets, obs = declarative(regs)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        c = transpile_to_stim(regs[0], coords=COORDS, detectors=dets, observables=obs)
    assert c == stim.Circuit(str(transpile_to_stim(regs[0], coords=COORDS)) + DECLARATIVE)
    assert not c.compile_detector_sampler().sample(50).any()


def test_declarative_lists_of_clbit_indices():
    qc, syn, fin = rep3(looped=False, per_round_regs=True)
    with pytest.warns(DetectorCompletenessWarning):  # r0[0]; r0[1]^r1[1]; fin[0]^fin[1]
        c = transpile_to_stim(qc, detectors=[[0], [1, 3]], observables=[[6, 7]])
    assert str(c).endswith("DETECTOR(0, 0, 0) rec[-9]\nDETECTOR(0, 0, 0) rec[-8] rec[-6]\n"
                           "OBSERVABLE_INCLUDE(0) rec[-3] rec[-2]")


def test_unmeasured_clbit_raises():
    qc = QuantumCircuit(1, 2)
    qc.measure(0, 0)
    with pytest.raises(ValueError, match="clbit 1"):
        transpile_to_stim(qc, detectors=[[qc.clbits[1]]])


def test_missing_detector_warns_and_coords_are_absolute_in_repeat():
    qc, syn, _ = rep3()  # REPEAT block with SHIFT_COORDS(0, 0, 1)
    with pytest.warns(DetectorCompletenessWarning, match="1 detectors \\+ 0 observables = 1, but 9"):
        c = transpile_to_stim(qc, coords=COORDS, detectors=[{"clbits": [syn[0][0]], "qubits": [0, 1], "time": 2}])
    assert c.get_detector_coordinates() == {0: [1, 0, 2]}

    regs = rep3(looped=False, per_round_regs=True)
    dets, obs = declarative(regs)
    with pytest.warns(DetectorCompletenessWarning, match="7 detectors \\+ 1 observables = 8, but 9"):
        transpile_to_stim(regs[0], detectors=dets[1:], observables=obs)


def layers(c):
    """TICK-separated layers of a flattened circuit."""
    out, cur = [], []
    for inst in c.flattened():
        if inst.name == "TICK":
            out.append(cur)
            cur = []
        else:
            cur.append(inst)
    return out + [cur]


def targets(inst):
    return [t.value for t in inst.targets_copy()]


def test_unityq_noise_placement_and_dem():
    p = UnityQNoiseProfile()
    assert (p.p_1q, p.p_2q, p.p_meas) == pytest.approx((0.0015, 0.00875, 0.01))
    qc, _, fin = rep3(flip=True)
    noisy = add_noise(transpile_to_stim(qc, observables=[[fin[0]]]))
    flat = list(noisy.flattened())
    for i, inst in enumerate(flat):
        nxt, prv = flat[i + 1] if i + 1 < len(flat) else None, flat[i - 1]
        if inst.name == "X":
            assert (nxt.name, targets(nxt), nxt.gate_args_copy()) == ("DEPOLARIZE1", [0], pytest.approx([0.0015]))
        elif inst.name == "CX":
            assert (nxt.name, targets(nxt), nxt.gate_args_copy()) == ("DEPOLARIZE2", targets(inst),
                                                                       pytest.approx([0.00875]))
        elif inst.name == "M":
            assert (prv.name, targets(prv), prv.gate_args_copy()) == ("X_ERROR", targets(inst), pytest.approx([0.01]))
        elif inst.name == "R":
            assert (nxt.name, targets(nxt), nxt.gate_args_copy()) == ("X_ERROR", targets(inst), [p.p_reset])
    readout = [layer for layer in layers(noisy) if any(i.name == "M" for i in layer)]
    assert len(readout) == 4  # 3 syndrome rounds + final data readout
    for layer in readout:
        measured = {q for i in layer if i.name == "M" for q in targets(i)}
        (idle,) = [i for i in layer if i.name == "DEPOLARIZE1"]
        assert idle.gate_args_copy() == pytest.approx([p.idle_rate_per_us * p.t_meas_ns / 1000])
        assert set(targets(idle)) == set(range(5)) - measured
    noisy.detector_error_model(decompose_errors=True)


def test_noise_recurses_into_repeat_and_keeps_record_order():
    qc, _, fin = rep3(feedback=True)  # feedback ops interleave with measurements
    c = transpile_to_stim(qc, observables=[[fin[0]]])
    noisy = add_noise(c)
    (block,) = [op for op in noisy if isinstance(op, stim.CircuitRepeatBlock)]
    assert "DEPOLARIZE2" in str(block.body_copy())
    assert measured_qubits(noisy) == measured_qubits(c)
    assert detector_sets(noisy) == detector_sets(c)
    noisy.detector_error_model(decompose_errors=True)


def test_aer_noise_model_adapter():
    pytest.importorskip("qiskit_aer")
    from qiskit_aer import noise

    nm = noise.NoiseModel()
    nm.add_all_qubit_quantum_error(noise.depolarizing_error(0.01, 1), ["x"])
    nm.add_all_qubit_quantum_error(noise.pauli_error([("XI", 0.1), ("II", 0.9)]), ["cx"])  # X on the target
    nm.add_all_qubit_readout_error(noise.ReadoutError([[0.98, 0.02], [0.02, 0.98]]))
    p = UnityQNoiseProfile.from_noise_model(nm)
    qc = QuantumCircuit(2, 2)
    qc.x(0); qc.cx(0, 1); qc.h(1)
    qc.measure([0, 1], [0, 1])
    noisy = add_noise(transpile_to_stim(qc), p)
    assert noisy.approx_equals(stim.Circuit("""
        X 0
        DEPOLARIZE1(0.0075) 0
        TICK
        CX 0 1
        PAULI_CHANNEL_2(0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) 0 1
        TICK
        X_ERROR(0.02) 0
        H 1
        M 0
        TICK
        X_ERROR(0.02) 1
        M 1
        TICK
    """), atol=1e-12)  # ASAP: M 0 runs alongside H 1
    nm.add_all_qubit_quantum_error(noise.amplitude_damping_error(0.1), ["h"])
    with pytest.raises(NotImplementedError, match="non-Pauli"):
        UnityQNoiseProfile.from_noise_model(nm)


# str(transpile_to_stim(...)) captured before Phase 3 landed.
BASELINE = [
    ((True,), {}, 'X 0\nTICK\nREPEAT 3 {\n    CX 0 3 1 3 1 4 2 4\n    M 3\n    CX rec[-1] 3\n    M 4\n    CX rec[-1] 4\n'
                  '    TICK\n    SHIFT_COORDS(0, 0, 1)\n}\nM 3 4'),
    ((False,), {"fold_rounds": True}, 'X 0\nTICK\nREPEAT 3 {\n    CX 0 3 1 3 1 4 2 4\n    M 3\n    CX rec[-1] 3\n'
                                      '    M 4\n    CX rec[-1] 4\n    TICK\n    SHIFT_COORDS(0, 0, 1)\n}\nM 3 4'),
    ((True,), {"coords": {0: (0, 0), 3: (0.5, 0)}, "strip_in_circuit_feedback": True},
     'QUBIT_COORDS(0, 0) 0\nQUBIT_COORDS(0.5, 0) 3\nX 0\nTICK\nREPEAT 3 {\n    CX 0 3 1 3 1 4 2 4\n    M 3 4\n'
     '    TICK\n    SHIFT_COORDS(0, 0, 1)\n}\nM 3 4'),
]


@pytest.mark.parametrize("args, kw, text", BASELINE)
def test_unannotated_output_is_byte_identical(args, kw, text):
    assert str(transpile_to_stim(rep_code(*args), **kw)) == text
    assert str(transpile_to_stim(rep_code(*args), detectors=None, observables=None, **kw)) == text


def test_unannotated_loop_fallback_is_byte_identical():
    text = 'X 1\nM 1\nCX rec[-1] 0\nM 0\nCX rec[-2] 0\nM 0\nCX rec[-3] 0\nM 0\nCX rec[-4] 0\nM 0'
    assert str(transpile_to_stim(loop_with_pre_measurement(True, 0))) == text
