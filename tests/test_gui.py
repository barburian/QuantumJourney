from pathlib import Path

import pytest

pytest.importorskip("streamlit")
from streamlit.testing.v1 import AppTest

from qec_app import load_qasm, repetition_code
from qec_bridge import compile_qec


def test_default_run():
    at = AppTest.from_file(str(Path(__file__).parent.parent / "qec_app.py")).run(timeout=60)
    at.sidebar.number_input[-3].set_value(200)  # shots
    at.sidebar.button[0].click().run(timeout=60)
    assert not at.exception
    assert at.subheader[0].value == "Logical error rate"
    assert any(m.label == "Detectors" for m in at.metric)


def test_results_survive_rerun_and_timeslice_labels():
    at = AppTest.from_file(str(Path(__file__).parent.parent / "qec_app.py")).run(timeout=60)
    at.sidebar.number_input[-3].set_value(200)  # shots
    at.sidebar.button[0].click().run(timeout=60)
    at.slider[-1].set_value((2, 4)).run(timeout=60)  # tick range: a rerun without pressing Run
    assert not at.exception
    assert at.subheader[0].value == "Logical error rate"

    from qec_app import label_qubits
    res = compile_qec(repetition_code(3, 1)[0], observables=[[0]])
    svg = label_qubits(str(res.circuit.diagram("timeslice-svg")))
    assert all(f">q{q}</text>" in svg for q in range(5))


def test_builder_handoff():
    """What blueprints_app.py stores when the builder's "Send to QEC" button posts a circuit."""
    at = AppTest.from_file(str(Path(__file__).parent.parent / "qec_app.py"))
    at.session_state.builder_qasm = ('OPENQASM 3.0;\ninclude "stdgates.inc";\n\nqubit[2] q;\nbit[2] c;\n\n'
                                     'cx q[0], q[1];\nc[0] = measure q[0];\nc[1] = measure q[1];\n')
    at.session_state.builder_new = True
    at.run(timeout=60)
    assert at.sidebar.radio[0].value == "From circuit builder"
    at.sidebar.number_input[-3].set_value(200)  # shots
    at.sidebar.button[0].click().run(timeout=60)
    assert not at.exception  # at.error holds the expected "distance 1 vs target 3": no code here
    assert any(m.label == "Detectors" for m in at.metric)


def test_load_qasm():
    qc, obs = repetition_code(3, 2)
    from qiskit import qasm2
    loaded = load_qasm(qasm2.dumps(qc))
    assert compile_qec(loaded, observables=[[0]], shots=50, seed=0).report["shots"] == 50
    with pytest.raises(Exception):
        load_qasm("not qasm")
