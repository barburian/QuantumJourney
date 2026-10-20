"""Random Clifford circuit through qec_bridge; also writes random_clifford.qasm for the Streamlit GUI.

Run from the repo root: python examples/random_clifford.py
GUI: streamlit run app.py -> "Upload QASM" -> examples/random_clifford.qasm, observables [[0]].
"""
from pathlib import Path

from qiskit import qasm2
from qiskit.circuit.random import random_clifford_circuit

from qec_bridge.integration import compile_qec
from qec_bridge.noise import UnityQNoiseProfile
from qec_bridge.transpiler import transpile_to_stim

# Random Clifford U, then U^-1, then measure: every outcome is deterministically 0, so detectors can be inferred
# (a plain random circuit has random outcomes, leaving nothing to detect).
u = random_clifford_circuit(4, num_gates=12, seed=42)
qc = u.compose(u.inverse())
qc.measure_all()
print(qc.draw(fold=-1))
print(transpile_to_stim(qc))

# qasm2.loads only knows the qelib1 builtins (no swap/iswap/dcx), so decompose those before export.
basic = qc.decompose(["swap", "iswap", "iswap_dg", "dcx", "dcx_dg"], reps=2)
out = Path(__file__).with_name("random_clifford.qasm")
out.write_text(qasm2.dumps(basic))
print(f"wrote {out}")

res = compile_qec(qasm2.loads(out.read_text()), observables=[[0]], noise=UnityQNoiseProfile(), shots=20_000, seed=1)
print("detectors:", res.circuit.num_detectors, "| observables:", res.circuit.num_observables)
print("DEM errors:", res.dem.num_errors, "| decoder:", type(res.matcher).__name__)
print("report:", res.report)
