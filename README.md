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
- Example circuits (Bell, GHZ, Grover, QFT, …) and a library of your own, saved in the browser
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
```

`quantum-blueprints v1.html` is the original single-file prototype this project was built from.
