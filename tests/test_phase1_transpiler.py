import random

import pytest
import stim
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister
from qiskit.converters import circuit_to_dag
from qiskit.quantum_info import Operator

from qec_bridge import StimTranspiler, peephole_cx_cz_to_cy, transpile_to_stim

ONE_Q = ["id", "x", "y", "z", "h", "s", "sdg", "sx", "sxdg"]
TWO_Q = ["cx", "cy", "cz", "swap", "iswap", "cxcz", "czcx"]


def random_clifford(qc, seed, depth=30):
    rng = random.Random(seed)
    n = qc.num_qubits
    qc.id(range(n))  # make every qubit visible to stim
    for _ in range(depth):
        if n == 1 or rng.random() < 0.5:
            getattr(qc, rng.choice(ONE_Q))(rng.randrange(n))
            continue
        a, b = rng.sample(range(n), 2)
        g = rng.choice(TWO_Q)
        if g == "cxcz":
            qc.cx(a, b); qc.cz(a, b)
        elif g == "czcx":
            qc.cz(b, a); qc.cx(a, b)  # cz is symmetric
        else:
            getattr(qc, g)(a, b)
    return qc


def assert_same_unitary(qc):
    c = transpile_to_stim(qc)
    expected = stim.Tableau.from_unitary_matrix(Operator(qc).data, endian="little")
    assert stim.Tableau.from_circuit(c) == expected


@pytest.mark.parametrize("n", range(1, 6))
@pytest.mark.parametrize("seed", range(4))
def test_tableau_equivalence(n, seed):
    assert_same_unitary(random_clifford(QuantumCircuit(n), seed))


@pytest.mark.parametrize("seed", range(3))
def test_multi_register_flattening(seed):
    a, b = QuantumRegister(2, "a"), QuantumRegister(3, "b")
    qc = random_clifford(QuantumCircuit(a, b), seed)
    assert_same_unitary(qc)
    t = StimTranspiler(circuit_to_dag(qc))  # DAG input
    assert t.qubit_map == {q: i for i, q in enumerate(qc.qubits)}


@pytest.mark.parametrize("pair, fix", [
    (lambda qc: (qc.cx(0, 1), qc.cz(0, 1)), "S 0"),
    (lambda qc: (qc.cx(0, 1), qc.cz(1, 0)), "S 0"),
    (lambda qc: (qc.cz(0, 1), qc.cx(0, 1)), "S_DAG 0"),
    (lambda qc: (qc.cz(1, 0), qc.cx(0, 1)), "S_DAG 0"),
])
def test_peephole_rewrites_pair(pair, fix):
    qc = QuantumCircuit(2)
    pair(qc)
    text = str(transpile_to_stim(qc))
    assert "CY 0 1" in text and fix in text.splitlines()
    assert "CX" not in text and "CZ" not in text
    assert_same_unitary(qc)


def test_peephole_skips_non_adjacent():
    qc = QuantumCircuit(2)
    qc.cx(0, 1); qc.h(1); qc.cz(0, 1)
    assert [n.name for n in peephole_cx_cz_to_cy(circuit_to_dag(qc)).topological_op_nodes()] == ["cx", "h", "cz"]


def y_check(weight, ancilla_basis_y):
    """Data qubits in |+i> (Y=+1), ancilla-controlled cx+cz on each, ancilla read out."""
    qc = QuantumCircuit(weight + 1)
    anc = weight
    for d in range(weight):
        qc.h(d); qc.s(d)
    qc.h(anc)
    for d in range(weight):
        qc.cx(anc, d); qc.cz(anc, d)
    if ancilla_basis_y:
        qc.sdg(anc)
    qc.h(anc)
    return qc, anc


@pytest.mark.parametrize("weight, basis_y", [(4, False), (1, True)])
def test_y_stabilizer_deterministic(weight, basis_y):
    # weight 4: (iY)^4 = Y^4, so the ancilla reads +1 in Z. weight 1: cx.cz = C-(iY) leaves the
    # ancilla in |+i>, so it is only deterministic in the Y basis -- and only with the S fixup.
    qc, anc = y_check(weight, basis_y)
    c = transpile_to_stim(qc)
    assert "CY" in str(c) and "CX" not in str(c)
    sim = stim.TableauSimulator()
    sim.do(c)
    assert sim.peek_z(anc) == +1
    c.append("M", [anc])
    assert not c.compile_sampler().sample(200).any()
    # dropping the fixup (CY only) randomizes the weight-1 Y-basis readout
    if weight == 1:
        no_fix = stim.Circuit(str(c).replace("S 1\n", ""))
        assert stim.Circuit(str(c)) != no_fix
        sim = stim.TableauSimulator()
        sim.do(no_fix[:-1])
        assert sim.peek_z(anc) == 0


# --- multi-round repetition code: data 0,1,2; ancillas 3,4 ---

# Qiskit's topological order interleaves each measure with its own feedback.
ROUND = "CX 0 3 1 3 1 4 2 4\nM 3\nCX rec[-1] 3\nM 4\nCX rec[-1] 4\nTICK\nSHIFT_COORDS(0, 0, 1)"


def rep_round(qc, syn):
    qc.cx(0, 3); qc.cx(1, 3); qc.cx(1, 4); qc.cx(2, 4)
    qc.measure(3, syn[0]); qc.measure(4, syn[1])
    for i, anc in enumerate((3, 4)):
        with qc.if_test((syn[i], 1)):
            qc.x(anc)
    qc.barrier()


def rep_code(looped):
    q, syn, fin = QuantumRegister(5, "q"), ClassicalRegister(2, "syn"), ClassicalRegister(2, "fin")
    qc = QuantumCircuit(q, syn, fin)
    qc.x(0)  # error on data 0 -> syndrome (1, 0) every round
    qc.barrier()
    if looped:
        with qc.for_loop(range(3)):
            rep_round(qc, syn)
    else:
        for _ in range(3):
            rep_round(qc, syn)
    qc.measure([3, 4], fin)
    return qc


def repeat_blocks(c):
    return [op for op in c if isinstance(op, stim.CircuitRepeatBlock)]


@pytest.mark.parametrize("looped", [True, False])
def test_multi_round_record_tracking(looped):
    t = StimTranspiler(rep_code(looped), fold_rounds=not looped)
    (block,) = repeat_blocks(t.circuit)
    assert block.repeat_count == 3
    assert block.body_copy() == stim.Circuit(ROUND)
    assert t.measurement_data == [("syn", 0), ("syn", 1)] * 3 + [("fin", 0), ("fin", 1)]
    assert t.latest_clbit_meas_idx == {0: 4, 1: 5, 2: 6, 3: 7}
    shots = t.circuit.compile_sampler().sample(10)
    assert shots.shape == (10, 8)
    assert (shots[:, :6] == [1, 0] * 3).all()
    assert not shots[:, 6:].any()  # active reset worked: ancillas end in |0>


def test_strip_feedback():
    c = transpile_to_stim(rep_code(True), strip_in_circuit_feedback=True)
    assert "rec" not in str(c)
    assert repeat_blocks(c)[0].body_copy() == stim.Circuit(ROUND.replace("CX rec[-1] 3\n", "").replace("CX rec[-1] 4\n", ""))


def loop_with_pre_measurement(looped, target):
    """Flip q0 on c[1] (measured pre-loop as 1), then measure q0 into c[target].

    target=0: c[1] is never re-measured, so every iteration's rec offset differs -> full unroll.
    target=1: an extra pre-loop M makes iteration 1 see rec[-2], later ones rec[-1] -> 1 flat + REPEAT 3.
    """
    qc = QuantumCircuit(2, 3)
    qc.x(1)
    qc.measure(1, 1)
    if target == 1:
        qc.measure(0, 2)  # on q0 so it is ordered before the loop
    def body():
        with qc.if_test((qc.clbits[1], 1)):
            qc.x(0)
        qc.measure(0, target)
    if looped:
        with qc.for_loop(range(4)):
            body()
    else:
        for _ in range(4):
            body()
    return qc


@pytest.mark.parametrize("target, repeats, last4", [(0, [], [1, 0, 1, 0]), (1, [3], [1, 0, 0, 0])])
def test_loop_fallback_matches_unrolled(target, repeats, last4):
    c = transpile_to_stim(loop_with_pre_measurement(True, target))
    assert [b.repeat_count for b in repeat_blocks(c)] == repeats
    assert c.flattened() == transpile_to_stim(loop_with_pre_measurement(False, target))
    assert c.compile_sampler().sample(5)[:, -4:].tolist() == [last4] * 5


@pytest.mark.parametrize("n", range(4))
def test_loop_counts(n):
    qc = QuantumCircuit(1, 1)
    with qc.for_loop(range(n)):
        qc.measure(0, 0)
    c = transpile_to_stim(qc)
    assert c.num_measurements == n
    assert bool(repeat_blocks(c)) == (n >= 2)


def test_qubit_coords():
    q = QuantumRegister(3, "q")
    qc = QuantumCircuit(q)
    qc.h(q)
    c1 = transpile_to_stim(qc, coords={2: (2,), 0: (0,), 1: (1,)})
    assert str(c1).startswith("QUBIT_COORDS(0) 0\nQUBIT_COORDS(1) 1\nQUBIT_COORDS(2) 2\nH")
    c2 = transpile_to_stim(qc, coords={q[1]: (1, 0), q[0]: (0, 0), 2: (0, 1)})
    assert str(c2).startswith("QUBIT_COORDS(0, 0) 0\nQUBIT_COORDS(1, 0) 1\nQUBIT_COORDS(0, 1) 2\nH")


def test_record_before_measure():
    qc = QuantumCircuit(1, 1)
    with qc.if_test((qc.clbits[0], 1)):
        qc.x(0)
    with pytest.raises(ValueError, match="before being measured"):
        transpile_to_stim(qc)


def bad_else(qc):
    with qc.if_test((qc.clbits[0], 1)) as else_:
        qc.x(0)
    with else_:
        qc.z(0)


def bad_register(qc):
    with qc.if_test((qc.cregs[0], 1)):
        qc.x(0)


def bad_value(qc):
    with qc.if_test((qc.clbits[0], 0)):
        qc.x(0)


def bad_body(qc):
    with qc.if_test((qc.clbits[0], 1)):
        qc.h(0)


def bad_loop_param(qc):
    with qc.for_loop(range(2)) as i:
        qc.rx(i, 0)


@pytest.mark.parametrize("build", [lambda qc: qc.t(0), bad_else, bad_register, bad_value, bad_body, bad_loop_param])
def test_not_implemented(build):
    qc = QuantumCircuit(QuantumRegister(1), ClassicalRegister(1))
    qc.measure(0, 0)
    build(qc)
    with pytest.raises(NotImplementedError):
        transpile_to_stim(qc)
