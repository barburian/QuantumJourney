# Quantum Blueprints

A node-based quantum circuit builder that runs in the browser. Place qubits and gates on a canvas,
wire them pin to pin, and watch the final probabilities update live from a built-in state-vector
simulator.

- Gates: H, X, Y, Z, S, T, rotations Rx/Ry/Rz/P, two-qubit CNOT, CZ, SWAP, CP, and measurement
- Initial states |0⟩, |1⟩, |+⟩, |−⟩ (click the state badge on a qubit)
- Measurements can **peek** (read P(1) without disturbing the state) or **collapse** (branch the
  simulation, so mid-circuit measurement is exact)
- **Probes** show a qubit's Bloch sphere, P(1), θ/φ and the phase-coloured state vector at any
  point; they pass the state through unchanged
- **Live wires** show the state they carry: thickness = P(1), colour = phase (blue at 0),
  a pulsing glow = entangled with other qubits. Hover a wire for details.
- **Custom gates**: collapse any selection into a reusable block, open it to edit it, and make
  its inverse (†) or a controlled version (C) with one click. Custom gates can contain each other.
- **Classical logic**: *Number* (slider) and *Math* blocks, angles driven by classical wires, and
  measurement bits that make later gates conditional, evaluated per measurement branch
- **Variational algorithms (VQE, QAOA)**: an *Expectation* block measures ⟨H⟩ for a Hamiltonian you
  type, and an *Optimizer* block tunes rotation angles to minimise or maximise it, with a live cost
  chart
- **Matrices**: the ⊞ button on any gate, custom ones included, shows its unitary matrix, updated
  live as you edit
- Example circuits (Bell, GHZ, Deutsch, Deutsch–Jozsa, teleportation, shared angle, Grover, QFT,
  mid-circuit measurement, VQE for H₂, QAOA MaxCut) and a
  library of your own circuits and gates, saved in the browser
- Up to 8 qubits

## Getting started

Requires [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm run dev        # start the dev server at http://localhost:5173
```

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Dev server with hot reload                 |
| `npm run build`     | Typecheck and build a static site to `dist/` |
| `npm run preview`   | Serve the production build locally         |
| `npm test`          | Run the simulator tests once               |
| `npm run typecheck` | Typecheck only                             |

The build uses relative paths, so `dist/` can be hosted from any folder (e.g. GitHub Pages).

## Using it

- **Click** a gate in the toolbar to chain it after the selected (or last added) block. With
  *Auto-connect* on it is wired in automatically. **Drag** a gate onto the canvas to place it freely.
- **Drag from pin to pin** to wire blocks; click a wire to delete it.
- **Drop** a Probe (or any single-qubit gate) **onto a wire** to splice it in. Clicking *Probe*
  with a connected block selected probes that block's output.
- **Drag** a block's header to move it; **Delete**/**Backspace** or the × removes the selected block.
- **Shift-click** blocks or **shift-drag** a box to select several; dragging one moves them all.
- **Make gate** (Ctrl+G) turns the selection into a custom gate. Each qubit passing through the
  selection becomes a lane, ordered top to bottom; the gate appears under *Custom* in the toolbar.
- On a custom gate, **†** runs it inverted and **C** adds a control pin (not available for gates
  that measure). **Double-click** it to edit its subcircuit, between its *Inputs* and *Outputs*
  blocks; the results there assume all inputs start in |0⟩. Changes apply to every copy of the
  gate. **Back** or **Esc** returns.
- **Classical wires** are orange and dashed; classical pins are small diamonds. One output can feed
  many inputs.
  - *Number* gives a value (slider from −2 to 2, or type any number). *Math* combines two values:
    + − × ÷, or the logic operations xor, and, or, not (any non-zero value counts as 1).
  - Rotation gates have a **θ** pin on top, in multiples of π: wire a value into it to drive the
    angle, e.g. one Number for several gates.
  - Measurements have a **bit** pin underneath. Wiring it switches the measurement to Collapse
    (only a collapsed measurement has a bit).
  - Drop a classical wire **anywhere on a gate** to make it conditional: it gains an **if** pin and
    only acts when the value is non-zero. Delete that wire and the gate is unconditional again.
  - Because measurements split the simulation into branches, each branch uses its own bits: this is
    how the *Teleportation* example applies its X and Z corrections.
  - A custom gate can contain Number and Math blocks, but classical wires can't cross its edge.
- **Variational loops**:
  - *Expectation* takes a Hamiltonian as a sum of Pauli terms, e.g.
    `-1.05 + 0.4 Z0 - 0.4 Z1 + 0.18 X0 X1` (Z0 acts on q0), and outputs ⟨H⟩ for the final state,
    averaged over measurement branches.
  - *Optimizer* has a **cost** input and one output per parameter (θ0, θ1, …; add or remove them with
    + θ / − θ). Wire the outputs into rotation angles (directly or through Math blocks) and an
    Expectation into cost, choose Minimise or Maximise, then **Run** (or **Step**). Each step
    estimates the gradient by finite differences and takes an Adam step; the chart shows the cost
    so far. *rate* is the step size, *steps* the most steps per run; **Reset** picks a random start.
  - The *VQE: H₂ molecule* example reaches the ground energy −1.857 Ha; *QAOA MaxCut* reaches
    ⟨cut⟩ = 3 on a 4-node ring, with the two maximum cuts as the most likely outcomes.
- Hover or select a gate and press **⊞** (top right) to see its matrix; cell colour is the phase.
  *Pin 0 last* matches the results panel (pin 0 is the rightmost bit); *Pin 0 first* is the usual
  textbook order. Up to 4 qubits show numbers, 5–6 qubits colours only (hover for values).
- Custom gates are stored automatically and listed under **My gates** in the library: click one to
  edit it, or × to delete it (along with its copies; you're asked first). Saved circuits keep their
  own copy of the gates they use.
- The **Deutsch** and **Deutsch–Jozsa** examples keep their oracle in a custom gate. Open it to
  change f: with no CNOTs inside (constant f) the inputs measure all 0.
- **Drag the background** to pan, **scroll** to zoom, *Fit* to frame the circuit.
- Results are shown in the basis |q(n−1)…q0⟩ (q0 is the rightmost bit).

## Project layout

```
index.html            page shell
src/
  main.ts             entry point
  types.ts            shared types
  gates.ts            gate definitions, palette groups, initial states
  simulator.ts        state-vector simulator (no DOM; unit tested)
  custom.ts           custom gates: grouping, inverse, control, expansion (no DOM; unit tested)
  scope.ts            making, editing and deleting custom gates
  gateStore.ts        storing custom gates in the browser
  matrix.ts           a block's unitary matrix (no DOM; unit tested)
  hamiltonian.ts      Pauli-sum Hamiltonians and expectation values (no DOM; unit tested)
  optimizer.ts        finite-difference gradients and Adam (no DOM; unit tested)
  optimizerRun.ts     running Optimizer blocks on the live circuit
  matrixView.ts       the matrix panel
  palette.ts          gate buttons, including custom gates
  snapshot.ts         circuit ⇄ plain data
  examples.ts         example circuits and op-list → circuit graph
  state.ts            editor state (nodes, wires, selection)
  circuit.ts          wiring rules (links, loop prevention, qubit tracing)
  nodes.ts            creating, placing, chaining and removing blocks
  render.ts           re-simulate and refresh the view
  wires.ts            wire drawing, including live state styling
  probe.ts            probe display (Bloch sphere, amplitude chart)
  phase.ts            phase → colour
  viewport.ts         pan and zoom
  results.ts          probability table
  library.ts          examples list and saved circuits (localStorage)
  toolbar.ts          gate palette and view buttons
  interaction.ts      pointer, keyboard and drag-and-drop handling
  styles.css
tests/
  simulator.test.ts
  custom.test.ts
  matrix.test.ts
  classical.test.ts
  variational.test.ts
```

`quantum-blueprints v1.html` is the original single-file prototype this project was built from.
