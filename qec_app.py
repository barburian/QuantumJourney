"""Minimal Streamlit GUI for qec_bridge: streamlit run app.py"""
import json
import re
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


def label_qubits(svg):
    """Stim timeslice SVG with a q<n> label above every qubit dot."""
    return re.sub(r'(<circle id="qubit_dot:(\d+):\d+" cx="([\d.]+)" cy="([\d.]+)"[^>]*/>)',
                  lambda m: f'{m[1]}<text x="{m[3]}" y="{float(m[4]) - 22}" text-anchor="middle" '
                            f'font-family="sans-serif" font-size="13" fill="#1f5fbf">q{m[2]}</text>', svg)


def zoomable(svg):
    """SVG in a scrollable white box (stim draws in black, invisible on a dark theme) with a zoom slider."""
    return f"""<style>body{{margin:0;font:14px sans-serif}} #w svg{{width:100%;height:auto;display:block}}</style>
<div style="background:#fff;padding:6px">Zoom <input type="range" id="z" min="100" max="600" step="10" value="100">
<span id="zv">100%</span> (or Ctrl+scroll over the diagram)</div>
<div style="overflow:auto;height:calc(100vh - 40px);background:#fff"><div id="w" style="width:100%">{svg}</div></div>
<script>
const set = v => {{ v = Math.round(Math.min(600, Math.max(100, v))); z.value = v; w.style.width = v + '%'; zv.textContent = v + '%'; }};
z.oninput = () => set(+z.value);
addEventListener('wheel', e => {{ if (e.ctrlKey) {{ e.preventDefault(); set(+z.value * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }} }},
                 {{ passive: false }});
</script>"""


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
        st.session_state.pop("qec", None)
        st.error(f"{type(e).__name__}: {e}")
        st.stop()
    # kept in session state so the result survives reruns from the widgets below (tick range, tabs)
    st.session_state.qec = dict(res=res, dist=dist, target=int(target), d=d,
                                warnings=[f"{w.category.__name__}: {w.message}" for w in caught])

if "qec" in st.session_state:
    res, dist, target, d, caught = st.session_state.qec.values()
    for w in caught:
        st.warning(w)
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
    graph, svg = st.tabs(["Matching graph 3D", "Timeslice"], key="view")
    with svg:
        n = res.circuit.num_ticks
        ticks = st.slider("Ticks to show (fewer = bigger panels)", 0, n - 1, (0, min(n - 1, 5))) if n > 1 else None
        diagram = label_qubits(str(res.circuit.diagram("timeslice-svg", tick=range(ticks[0], ticks[1] + 1))
                                   if ticks else res.circuit.diagram("timeslice-svg")))
        st.caption("● control and ⊕ target of a CNOT · **M** measure · **R** reset · **DEP₁ / DEP₂** random Pauli error "
                   "on 1 / 2 qubits · **ERR_X** bit flip · red number = that error's probability"
                   + (f" · q0–q{d - 1} are data qubits, q{d}–q{2 * d - 2} ancillas" if d else "")
                   + ". Full guide: README → Timeslice.")
        components.html(zoomable(diagram), height=650)
        st.download_button("Download full diagram (SVG)", label_qubits(str(res.circuit.diagram("timeslice-svg"))),
                           "timeslice.svg", "image/svg+xml", on_click="ignore")
    with graph:
        components.html(str(res.circuit.diagram("matchgraph-3d-html")), height=600)
    with st.expander("Stim circuit"):
        st.code(str(res.circuit))
