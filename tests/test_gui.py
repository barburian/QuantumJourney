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


def test_load_qasm():
    qc, obs = repetition_code(3, 2)
    from qiskit import qasm2
    loaded = load_qasm(qasm2.dumps(qc))
    assert compile_qec(loaded, observables=[[0]], shots=50, seed=0).report["shots"] == 50
    with pytest.raises(Exception):
        load_qasm("not qasm")
