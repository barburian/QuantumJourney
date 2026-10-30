# QuantumJourney

One browser app with two tools that work together:

| Page | What it is | Who built it |
| --- | --- | --- |
| **Circuit builder** | Quantum Blueprints: a node-based circuit editor with a live state-vector simulator | b33aify (`blueprints/`) |
| **QEC bridge** | `qec_bridge`: turns a Qiskit circuit into a noisy Stim circuit, decodes it with PyMatching and reports the logical error rate | barburian (`src/qec_bridge/`) |

You design a circuit in the builder, press **Send to QEC**, and the QEC bridge tells you how well that circuit survives realistic hardware noise once its errors are detected and corrected.

---

## 1. Running it

Requires Python 3.10+ and Node.js 20+.

```sh
pip install -e .[gui,test]                         # qec_bridge + Streamlit + the OpenQASM 3 importer
cd blueprints && npm install && npm run build && cd ..   # builds the circuit builder into blueprints/dist
streamlit run app.py                               # opens http://localhost:8501
```

The sidebar's top section switches between **Circuit builder** and **QEC bridge**.

* Rebuild the builder (`npm run build`) after every change to `blueprints/src`. If it was never built, the Circuit builder page says so instead of showing a blank frame.
* Tests: `pytest` (Python side) and `cd blueprints && npm test` (builder side).

### How the pieces fit

```
app.py               page switcher (st.navigation)
├─ blueprints_app.py   embeds blueprints/dist and listens for "Send to QEC"
│    └─ blueprints/    Bea's Vite + TypeScript app
└─ qec_app.py          the QEC bridge page
     └─ src/qec_bridge/  the pipeline (no UI code)
```

---

## 2. Circuit builder

Full guide: [`blueprints/README.md`](blueprints/README.md). The short version:

* **Toolbar (top):** gates to add (click to chain onto the selected block, drag to place freely), *Make gate* (turn a selection into a reusable custom gate), *Auto-connect*, *Live wires*, zoom −/+, *Fit*, *Clear*, *Export*, and **Send to QEC**.
* **Canvas (middle):** blocks wired pin to pin. Wire thickness = P(1), wire colour = phase, a glowing wire = entangled. Orange dashed wires carry classical values (measurement bits, numbers).
* **Library (right):** example circuits, your saved circuits and your custom gates (all stored in the browser).
* **Results (bottom):** the probability of every outcome, in the basis |q(n−1)…q0⟩ (q0 is the rightmost bit).
* **⊞** on a gate shows its unitary matrix. **Probe** blocks show a qubit's Bloch sphere at that point.

### Send to QEC

Exports the circuit as OpenQASM 3 (the same code as *Export → OpenQASM 3*) and opens the QEC bridge with it selected as the **From circuit builder** source. Qubit *k* is the *k*-th Qubit block. Every measurement writes its own bit of one classical register `c`, in the order the measurements appear, so `c[0]` is the first measurement.

What the QEC bridge can accept from the builder:

* **Clifford gates only:** H, X, Y, Z, S, CNOT, CZ, SWAP, measurement, plus rotations at Clifford angles (multiples of π/2). T gates and arbitrary angles fail with a `NonCliffordGateError` naming the gate. That is a real limit of stabilizer simulation, not a bug.
* **Deterministic measurements:** QEC needs measurements whose noiseless outcome is fixed. A Bell state measured in Z gives a random result per shot, so it can't be an observable. See [§4](#4-the-qec-bridge-page) for what that means.
* Custom gates made inverse (†) or controlled (C) export with `inv @`/`ctrl @`, which the Python OpenQASM 3 importer may not parse. If that happens, the sidebar shows **Bad input**.
* The button only appears when the builder runs inside this app. Bea's standalone build looks unchanged.

---

## 3. What the QEC bridge does

Quantum error correction (QEC) protects one **logical** bit of information by spreading it over many noisy physical qubits and repeatedly checking them for errors. The QEC bridge answers: *for this circuit and this noise level, how often does the decoder fail to correct the errors?*

The pipeline (`compile_qec` in `src/qec_bridge/integration.py`) runs these steps:

| Step | Module | What happens |
| --- | --- | --- |
| 1. Transpile | `transpiler.py` | The Qiskit circuit becomes a **Stim** circuit (Stim is a very fast simulator for Clifford circuits). Each gate is mapped to its Stim equivalent, or rebuilt from its matrix if it is a Clifford. `if (bit) x q;` feedback becomes a classically controlled Pauli. Repeated identical rounds can fold into `REPEAT` blocks. |
| 2. Annotate | `detectors.py` | Adds **DETECTOR**s and **OBSERVABLE**s (explained in §4). Detectors are either given by you or inferred automatically. |
| 3. Add noise | `noise.py` | Inserts error channels after every operation, using the Equal1 UnityQ hardware numbers by default. |
| 4. Build the error model | `decoding.py` | Stim works out every way a single fault can trip detectors and flip observables: the **detector error model (DEM)**. |
| 5. Decode | `decoding.py` | Turns the DEM into a matching graph and decodes it with **PyMatching** (minimum-weight perfect matching). If some faults trip more than 2 detectors (hyperedges), it falls back to a **BP-OSD** decoder. |
| 6. Simulate | `decoding.py` | Samples thousands of noisy runs (shots), decodes each one, and counts how often the decoder's correction is wrong. |
| 7. Check distance | `diagnostics.py` | Finds the smallest number of faults that cause an undetected logical error. |

---

## 4. The QEC bridge page

### Sidebar

#### Circuit source

| Option | Use it for |
| --- | --- |
| **Repetition code** | A built-in example. Works out of the box, and the best way to learn the page. |
| **Upload QASM** | Your own `.qasm` file (OpenQASM 2, or 3 as a fallback). `examples/random_clifford.qasm` is a ready-made one (use observables `[[0]]`). |
| **From circuit builder** | Appears after you press *Send to QEC* in the builder. Holds the last circuit sent. |

#### Repetition code settings

The repetition code protects one bit against bit flips by copying it onto *d* data qubits and repeatedly measuring the parity of neighbouring pairs with *d − 1* helper (ancilla) qubits.

* **Distance d** (3, 5, 7, 9): the number of data qubits. A distance-*d* code corrects up to ⌊(d−1)/2⌋ bit flips, so d = 3 survives 1 error and d = 5 survives 2. The circuit uses 2d − 1 qubits.
* **Rounds** (1–10): how many times the parity checks repeat before the final readout. Each round measures every ancilla into its own classical register (`r0`, `r1`, …) and resets it. The final register `fin` reads all data qubits.

The observable is fixed to `fin[0]`, the first data qubit's final value.

#### Upload / builder settings

* The caption **"Circuits must be Clifford and need one ClassicalRegister per round"** says two things. Non-Clifford gates can't be simulated by Stim, and each round must write to fresh classical bits, because a bit that is overwritten by a later round loses the earlier result the detectors need.
* **Observables (JSON list of lists of clbit indices):** which measured bits make up the logical result you care about. Each inner list is one observable, and its value is the XOR (parity) of those bits. `[[0]]` means "observable 0 = classical bit 0". `[[0, 1], [2]]` means two observables: bit 0 XOR bit 1, and bit 2. Indices count across all classical registers in declaration order. The observable must be **deterministic**: without noise it must always give the same value, or the page shows an error.
* **Detectors (JSON, blank = inferred):** the parity checks used to spot errors. Leave blank to infer them. Otherwise give a list of lists of clbit indices, for example `[[0, 3], [1, 4]]`, where each inner list is a set of bits whose XOR is always 0 without noise. A dict form `{"clbits": [...], "qubits": [...], "time": t}` also places the detector in the 3D view.

**What is a detector?** A detector is a group of measurement results whose combined parity is always 0 when nothing goes wrong. When noise flips it to 1, the detector "fires", and the pattern of firing detectors is what the decoder uses to guess which errors happened. Inference (`infer_detectors`) finds, for every measurement, the most recent earlier measurements that fully predict it, which is usually the same ancilla in the previous round.

#### Noise (expander)

Defaults are the Equal1 UnityQ 22FDX silicon-spin benchmark numbers.

| Field | Meaning | Default | Becomes |
| --- | --- | --- | --- |
| **Noiseless** | Turns all noise off. Useful to check the circuit is valid: every detector should stay silent, and the logical error rate should be 0. It also disables the distance check. | off | |
| **f_1q** | Average fidelity of a single-qubit gate | 0.999 | depolarizing error p = 1.5 × (1 − f) = 0.0015 after every 1-qubit gate |
| **f_2q** | Average fidelity of a two-qubit gate | 0.993 | depolarizing error p = 1.25 × (1 − f) = 0.00875 after every 2-qubit gate |
| **f_meas** | Readout fidelity | 0.990 | a 1% chance the measured bit is flipped |
| **p_reset** | Chance a reset leaves the qubit in \|1⟩ instead of \|0⟩ | 0.001 | bit flip right after each reset (*placeholder value*) |
| **idle_rate_per_us** | Depolarizing probability per microsecond a qubit spends waiting | 1e-4 | idle noise (*placeholder value*) |

**Fidelity** is 1 minus the error probability. *Depolarizing* noise applies a random Pauli error (X, Y or Z) with probability p. Idle noise comes from timing: operations are packed into layers, each layer takes as long as its slowest operation (1q gate 140 ns, 2q gate 200 ns, measurement 10 µs, reset 1 µs), and every qubit that waits during a layer gets idle noise for the time it waited. Measurements are by far the slowest step, so ancilla readout dominates idle errors.

#### Run settings

* **Shots:** how many noisy runs to simulate. The rate's resolution is 1/shots, so 10 000 shots can't measure anything below 1e-4 (zero failures just means "below about 1/shots").
* **Seed:** fixes the random numbers, so the same settings give the same result every time. Change it to get a fresh sample.
* **Target distance:** the distance you expect the circuit to have. It defaults to *d* for the repetition code and 3 otherwise, and is disabled when Noiseless is on.
* **Run:** runs the pipeline. It's greyed out until a circuit is loaded.

### Results

#### Metrics row

| Metric | Meaning | Repetition code d=3, 3 rounds |
| --- | --- | --- |
| **Detectors** | Number of parity checks in the circuit | 8 (2 ancillas × 3 rounds, plus 2 final checks comparing data qubits) |
| **Observables** | Number of logical bits tracked | 1 |
| **Decoder** | `Matching` = PyMatching (every fault trips at most 2 detectors). Anything else = the BP-OSD fallback for hyperedges, which needs `pip install beliefmatching ldpc`. | Matching |
| **Shots** | Shots simulated | 10000 |

#### Logical error rate

* **observable *i*:** the fraction of shots where the decoder's corrected value of observable *i* was **wrong**. Lower is better.
* **any:** the fraction of shots where at least one observable was wrong. With one observable it equals observable 0.

For reference, with the default noise and 10 000 shots: d = 3 gives about **0.003**, and d = 5 gives about **0.0006**. A larger code fails less often, which is the whole point of QEC. If increasing *d* makes the rate go **up**, the physical noise is above the code's *threshold*, and adding qubits only adds more places for errors.

#### Measured distance vs target

* **Measured distance:** the smallest number of single faults that together flip an observable without any detector noticing (`shortest_graphlike_error`). This is the circuit's real error-correcting strength.
* Green (**success**): measured ≥ target. Red (**error**): measured < target, meaning the circuit is weaker than intended. The usual causes are a missing detector, a wrongly chosen observable, or a hook error where one fault on an ancilla spreads to several data qubits.
* A circuit sent from the builder with no error correction built in (for example a Bell pair) honestly shows **distance 1**: one error is enough to break it.

#### Warnings (yellow)

| Warning | Meaning |
| --- | --- |
| `FaultDistanceWarning` | Same as the red distance message above. |
| `DetectorCompletenessWarning` | Detectors + observables don't cover every measurement that has a fixed outcome, so some error information goes unused. Usually harmless for hand-written detectors, but worth checking. |

#### Errors (red, before results)

| Error | Meaning |
| --- | --- |
| `NonCliffordGateError: gate 't' on qubits [0] is not Clifford` | The circuit has a gate Stim can't simulate. Remove it, or use a Clifford angle. |
| `NotImplementedError` | A construct the transpiler doesn't handle yet: feedback other than `if bit: x/y/z`, an `else` branch, or measurements other than Z when inferring detectors. |
| `ValueError` … non-deterministic | An observable or detector doesn't have a fixed outcome without noise. Pick different bits. |
| `ValueError: clbit N referenced before being measured` | An index in Observables/Detectors points at a bit that is never written. |
| **Bad input:** … | The JSON fields or the QASM text didn't parse. |
| `ImportError` | An optional package is missing, for example BP-OSD (`beliefmatching`, `ldpc`) or `qiskit_qasm3_import`. |

#### Matching graph 3D (tab)

A 3D view of the decoder's graph. Each **node** is a detector, placed at (qubit position, round). Each **edge** is one possible fault and connects the detectors that fault would trip. Edges to the boundary are faults that trip only one detector, such as errors on end data qubits. Drag to rotate and scroll to zoom. The decoder's job is to explain a set of firing detectors with the cheapest set of edges. The measured distance is the shortest chain of edges connecting the boundary to itself while flipping an observable.

#### Timeslice (tab)

The noisy Stim circuit drawn one layer (`TICK`) at a time, left to right. Each panel shows the gates, the inserted noise channels, measurements and resets of that layer on the qubit grid. Use it to check gate ordering and where the noise lands.

#### Stim circuit (expander)

The full noisy circuit as Stim text. Useful lines:

* `H`, `CX`, `M`, `R`, … gates, measurements and resets.
* `DEPOLARIZE1(p)`, `DEPOLARIZE2(p)`, `X_ERROR(p)`: the noise.
* `DETECTOR(x, y, t) rec[-a] rec[-b]`: a detector over earlier measurement results (`rec[-1]` = the most recent measurement).
* `OBSERVABLE_INCLUDE(0) rec[-k]`: the bits that make up observable 0.
* `TICK`: a layer boundary. `REPEAT n { … }`: n identical rounds.
* `CX rec[-1] 2`: classical feedback ("apply X to qubit 2 if the last measurement was 1").

---

## 5. Using `qec_bridge` from Python

```python
from qec_bridge import compile_qec, check_distance, UnityQNoiseProfile

res = compile_qec(qc, observables=[[0]], noise=UnityQNoiseProfile(), shots=10_000, seed=0)
res.circuit        # noisy annotated stim.Circuit
res.dem            # stim.DetectorErrorModel
res.report         # {"shots", "per_observable": [...], "any": ...}
check_distance(res.circuit, 3)
```

Other entry points: `transpile_to_stim` (step 1 only), `add_noise`, `build_dem`, `simulate`, `decode_bitstrings` (logical error rate from real hardware counts), `StimTranslationPass` (a Qiskit transpiler pass) and `make_sinter_tasks` / `run_sweep` (threshold sweeps with sinter). The full design is in `Quantum Circuit Conversion Tool Plan.docx`.
