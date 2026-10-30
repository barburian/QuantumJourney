"""Minimal Streamlit GUI for qec_bridge: streamlit run app.py"""
import json
import warnings

import streamlit as st
import streamlit.components.v1 as components
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister, qasm2, qasm3

from qec_bridge import NonCliffordGateError, UnityQNoiseProfile, check_distance, compile_qec


def repetition_code(d, rounds):
    """Bit-flip repetition code (data 0..d-1, ancillas d..2d-2), one ClassicalRegister per round, final readout 'fin'."""
    fin = ClassicalRegister(d, "fin")
    syn = [ClassicalRegister(d - 1, f"r{r}") for r in range(rounds)]
    qc = QuantumCircuit(QuantumRegister(2 * d - 1, "q"), fin, *syn)
    for reg in syn:
        for i in range(d - 1):
            qc.cx(i, d + i)
            qc.cx(i + 1, d + i)
        qc.measure(range(d, 2 * d - 1), reg)
        qc.reset(range(d, 2 * d - 1))
        qc.barrier()
    qc.measure(range(d), fin)
    return qc, [[fin[0]]]


def load_qasm(text):
    """OpenQASM 2 text -> QuantumCircuit; falls back to OpenQASM 3 if qasm2 fails and qiskit_qasm3_import exists."""
    try:
        return qasm2.loads(text)
    except Exception:
        try:
            from qiskit import qasm3
            return qasm3.loads(text)
        except ImportError:
            raise  # no qasm3 importer: report the qasm2 failure
        except Exception:
            return qasm2.loads(text)  # re-raise the qasm2 error, it is the more useful one


st.title("qec_bridge")
if st.session_state.pop("builder_new", False):  # just sent from the circuit builder
    st.session_state.src = "From circuit builder"
sources = ["Repetition code", "Upload QASM"] + (["From circuit builder"] if "builder_qasm" in st.session_state else [])
src = st.sidebar.radio("Circuit source", sources, key="src")
qc = observables = detectors = None
if src == "Repetition code":
    d = st.sidebar.select_slider("Distance d", [3, 5, 7, 9])
    rounds = st.sidebar.slider("Rounds", 1, 10, 3)
    qc, observables = repetition_code(d, rounds)
else:
    d = None
    st.sidebar.caption("Circuits must be Clifford and need one ClassicalRegister per round.")
    up = None if src == "From circuit builder" else st.sidebar.file_uploader("QASM file", type=["qasm"])
    obs_txt = st.sidebar.text_input("Observables (JSON list of lists of clbit indices)", "[[0]]")
    det_txt = st.sidebar.text_input("Detectors (JSON, blank = inferred)", "")
    try:
        observables = json.loads(obs_txt)
        detectors = json.loads(det_txt) if det_txt.strip() else None
        if src == "From circuit builder":
            qc = qasm3.loads(st.session_state.builder_qasm)  # the builder always exports OpenQASM 3
        elif up is not None:
            qc = load_qasm(up.getvalue().decode())
    except (ValueError, qasm2.QASM2ParseError, qasm3.QASM3ImporterError, ImportError) as e:
        st.sidebar.error(f"Bad input: {e}")

with st.sidebar.expander("Noise"):
    noiseless = st.checkbox("Noiseless")
    p = UnityQNoiseProfile()
    kw = {k: st.number_input(k, value=getattr(p, k), format="%g") for k in
          ["f_1q", "f_2q", "f_meas", "p_reset", "idle_rate_per_us"]}
shots = st.sidebar.number_input("Shots", 1, value=10_000)
seed = st.sidebar.number_input("Seed", value=0)
target = st.sidebar.number_input("Target distance", 1, value=d or 3, disabled=noiseless)

if st.sidebar.button("Run", disabled=qc is None):
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            res = compile_qec(qc, detectors=detectors, observables=observables,
                              noise=None if noiseless else UnityQNoiseProfile(**kw), shots=int(shots), seed=int(seed))
            dist = None if noiseless else check_distance(res.circuit, int(target))
    except (NonCliffordGateError, NotImplementedError, ValueError, ImportError) as e:
        st.error(f"{type(e).__name__}: {e}")
        st.stop()
    for w in caught:
        st.warning(f"{w.category.__name__}: {w.message}")
    rep = res.report
    cols = st.columns(4)
    cols[0].metric("Detectors", res.dem.num_detectors)
    cols[1].metric("Observables", res.dem.num_observables)
    cols[2].metric("Decoder", type(res.matcher).__name__)
    cols[3].metric("Shots", rep["shots"])
    st.subheader("Logical error rate")
    for i, r in enumerate(rep["per_observable"]):
        st.write(f"observable {i}: {r:.4g}")
    st.write(f"any: {rep['any']:.4g}")
    if dist is not None:
        (st.success if dist >= target else st.error)(f"Measured distance {dist} vs target {int(target)}")
    # 3D viewer first: it sizes its camera on load and stays blank if it loads in a hidden tab
    graph, svg = st.tabs(["Matching graph 3D", "Timeslice"])
    with svg:
        components.html(str(res.circuit.diagram("timeslice-svg")), height=600, scrolling=True)
    with graph:
        components.html(str(res.circuit.diagram("matchgraph-3d-html")), height=600)
    with st.expander("Stim circuit"):
        st.code(str(res.circuit))
