import numpy as np
import pytest
import stim
from qiskit import QuantumCircuit
from qiskit.circuit.library import CZGate, HGate, SGate, UnitaryGate, iSwapGate
from qiskit.quantum_info import random_clifford

from qec_bridge import NonCliffordGateError, transpile_to_stim, unitary_to_stim

SQRT_SWAP = np.array([[1, 0, 0, 0], [0, (1 + 1j) / 2, (1 - 1j) / 2, 0], [0, (1 - 1j) / 2, (1 + 1j) / 2, 0], [0, 0, 0, 1]])


def _unitary_circuit(U, n):
    qc = QuantumCircuit(n)
    qc.append(UnitaryGate(U), range(n))
    return qc


def test_composite_gate_is_unrolled_and_tagged():
    bell = QuantumCircuit(2, name="bell")
    bell.h(0)
    bell.cx(0, 1)
    outer = QuantumCircuit(2, name="outer")  # nested: outermost tag wins
    outer.append(bell.to_gate(), [1, 0])
    qc = QuantumCircuit(3)
    qc.append(outer.to_gate(), [2, 0])
    assert transpile_to_stim(qc) == stim.Circuit("H[outer] 0\nCX[outer] 0 2")


@pytest.mark.parametrize("U", [HGate().to_matrix(), SGate().to_matrix(), CZGate().to_matrix(),
                               iSwapGate().to_matrix(), random_clifford(2, seed=7).to_matrix()])
def test_clifford_unitary_round_trips(U):
    n = int(np.log2(len(U)))
    out = transpile_to_stim(_unitary_circuit(U, n))
    assert stim.Tableau.from_circuit(out) == stim.Tableau.from_unitary_matrix(U, endian="little")


def test_sqrt_swap_pair_consolidates_to_swap():
    qc = QuantumCircuit(2)
    qc.append(UnitaryGate(SQRT_SWAP), [0, 1])
    qc.append(UnitaryGate(SQRT_SWAP), [1, 0])
    swap = stim.Tableau.from_named_gate("SWAP")
    assert stim.Tableau.from_circuit(transpile_to_stim(qc)) == swap


@pytest.mark.parametrize("build", [lambda qc: qc.t(0),
                                   lambda qc: qc.append(UnitaryGate(np.diag([np.exp(-0.15j), np.exp(0.15j)])), [0])])
def test_non_clifford_raises(build):
    qc = QuantumCircuit(1)
    build(qc)
    with pytest.raises(NonCliffordGateError) as e:
        transpile_to_stim(qc)
    assert isinstance(e.value, NotImplementedError) and e.value.qubits == [0]


def test_cache_hit_on_repeated_matrix():
    unitary_to_stim.cache_clear()
    qc = _unitary_circuit(HGate().to_matrix(), 1)
    transpile_to_stim(qc)
    hits = unitary_to_stim.cache_info().hits
    transpile_to_stim(qc)
    assert unitary_to_stim.cache_info().hits > hits
