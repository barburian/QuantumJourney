"""Phase 1: translate Clifford Qiskit circuits (with measurement, feedback, loops) into stim.Circuit.

Phase 2: unroll custom composite gates (tagged) and synthesize Clifford unitaries via stim tableaus.
"""
from functools import lru_cache

import numpy as np
import stim
from qiskit import QuantumCircuit
from qiskit.circuit import Clbit, ControlFlowOp, Gate
from qiskit.circuit.library import CYGate, SdgGate, SGate, UnitaryGate, get_standard_gate_name_mapping
from qiskit.quantum_info import Operator
from qiskit.converters import circuit_to_dag, dag_to_circuit
from qiskit.dagcircuit import DAGOpNode

from .detectors import annotate

GATES = {
    "id": "I", "x": "X", "y": "Y", "z": "Z", "h": "H", "s": "S", "sdg": "S_DAG",
    "sx": "SQRT_X", "sxdg": "SQRT_X_DAG", "cx": "CX", "cy": "CY", "cz": "CZ",
    "swap": "SWAP", "iswap": "ISWAP", "reset": "R",
}
FEEDBACK = {"x": "CX", "y": "CY", "z": "CZ"}
SHIFT = stim.Circuit("SHIFT_COORDS(0, 0, 1)")
STANDARD = set(get_standard_gate_name_mapping())  # synthesized from their matrix, never unrolled


class NonCliffordGateError(NotImplementedError):
    """A gate whose (consolidated) unitary is not Clifford; hook for a later non-Clifford router."""

    def __init__(self, gate_name, qubits):
        super().__init__(f"gate {gate_name!r} on qubits {qubits} is not Clifford")
        self.gate_name, self.qubits = gate_name, qubits


@lru_cache(maxsize=None)
def unitary_to_stim(key, n):
    """Cached: rounded little-endian n x n unitary bytes -> stim.Circuit on local qubits 0..k-1."""
    U = np.frombuffer(key, dtype=complex).reshape(n, n)
    tableau = stim.Tableau.from_unitary_matrix(U, endian="little")
    # stim only spot-checks columns (RZ(0.3) comes back as I), so compare back up to global phase.
    if not np.isclose(abs(np.vdot(tableau.to_unitary_matrix(endian="little"), U)), n, atol=1e-6):
        raise ValueError("unitary is not Clifford")
    return tableau.to_circuit(method="elimination")


def synthesize_unitary(U):
    """Stim circuit for a Clifford unitary; raises ValueError if U is not Clifford."""
    U = np.round(np.asarray(U, dtype=complex), 10) + 0.0  # +0.0 folds -0.0 so equal matrices share a key
    return unitary_to_stim(U.tobytes(), U.shape[0])


def _mergeable(node):
    op = node.op
    return (isinstance(op, Gate) and node.name not in GATES and op.num_qubits <= 2
            and not op.is_parameterized())


def consolidate_blocks(dag):
    """Return a new DAG where wire-adjacent runs of non-native <=2q gates on one qubit set become a UnitaryGate.

    Lone gates are kept as-is (custom gates keep their tag); e.g. sqrt(SWAP).sqrt(SWAP) -> SWAP.
    """
    new = dag.copy_empty_like()
    skip = set()
    for node in dag.topological_op_nodes():
        if node._node_id in skip:
            continue
        if not _mergeable(node):
            new.apply_operation_back(node.op, node.qargs, node.cargs)
            continue
        idx = {q: i for i, q in enumerate(node.qargs)}
        acc, names, cur = Operator(node.op), [node.name], node
        while True:
            succ = list({s._node_id: s for s in dag.quantum_successors(cur)}.values())
            if not (len(succ) == 1 and isinstance(succ[0], DAGOpNode) and _mergeable(succ[0])
                    and set(succ[0].qargs) == set(idx)):
                break
            cur = succ[0]
            acc = acc.compose(Operator(cur.op), qargs=[idx[q] for q in cur.qargs])
            names.append(cur.name)
            skip.add(cur._node_id)
        op = node.op if len(names) == 1 else UnitaryGate(acc, label="+".join(names), check_input=False)
        new.apply_operation_back(op, node.qargs, ())
    return new


def peephole_cx_cz_to_cy(dag):
    """Return a new DAG where cx(c,t),cz(c,t) -> CY(c,t),S(c) and cz(c,t),cx(c,t) -> CY(c,t),S_DAG(c).

    Exact: CZ.CX = C-(ZX) = C-(iY) = S(c).CY and CX.CZ = C-(XZ) = C-(-iY) = S_DAG(c).CY.
    Pairs must be adjacent on both wires; control-flow bodies are rewritten recursively.
    """
    new = dag.copy_empty_like()
    skip = set()
    for node in dag.topological_op_nodes():
        if node._node_id in skip:
            continue
        op = node.op
        if isinstance(op, ControlFlowOp):
            op = op.replace_blocks([dag_to_circuit(peephole_cx_cz_to_cy(circuit_to_dag(b))) for b in op.blocks])
        elif node.name in ("cx", "cz"):
            succ = list({s._node_id: s for s in dag.quantum_successors(node)}.values())
            other = "cz" if node.name == "cx" else "cx"
            if (len(succ) == 1 and isinstance(succ[0], DAGOpNode) and succ[0].name == other
                    and set(succ[0].qargs) == set(node.qargs)):
                c, t = (node if node.name == "cx" else succ[0]).qargs
                new.apply_operation_back(CYGate(), (c, t), ())
                new.apply_operation_back(SGate() if node.name == "cx" else SdgGate(), (c,), ())
                skip.add(succ[0]._node_id)
                continue
        new.apply_operation_back(op, node.qargs, node.cargs)
    return new


def _flatten(regs, bits):
    """Global ints by walking registers with running offsets; loose bits appended in DAG order."""
    m = {}
    for reg in regs:
        for b in reg:
            m.setdefault(b, len(m))
    for b in bits:
        m.setdefault(b, len(m))
    return m


def _fold_rounds(circuit):
    """Collapse runs of >=2 identical TICK-terminated top-level segments into REPEAT blocks."""
    segs, cur = [], stim.Circuit()
    for inst in circuit:
        cur.append(inst)
        if isinstance(inst, stim.CircuitInstruction) and inst.name == "TICK":
            segs.append(cur)
            cur = stim.Circuit()
    if len(cur):
        segs.append(cur)
    out, i = stim.Circuit(), 0
    while i < len(segs):
        j = i
        while j + 1 < len(segs) and segs[j + 1] == segs[i]:
            j += 1
        if j > i:  # identical text => rec offsets are shift-invariant
            out.append(stim.CircuitRepeatBlock(j - i + 1, segs[i] + SHIFT))
        else:
            out += segs[i]
        i = j + 1
    return out


class StimTranspiler:
    """Translates one circuit; keeps qubit_map, clbit_map and the measurement record for inspection."""

    def __init__(self, qc_or_dag, coords=None, strip_in_circuit_feedback=False, fold_rounds=False):
        dag = circuit_to_dag(qc_or_dag) if isinstance(qc_or_dag, QuantumCircuit) else qc_or_dag
        dag = peephole_cx_cz_to_cy(dag)
        self.strip = strip_in_circuit_feedback
        self.qubit_map = _flatten(dag.qregs.values(), dag.qubits)
        self.clbit_map = _flatten(dag.cregs.values(), dag.clbits)
        self.clbit_label = {}
        for creg in dag.cregs.values():
            for i, b in enumerate(creg):
                self.clbit_label.setdefault(self.clbit_map[b], (creg.name, i))
        self.measurement_data = []  # append-only: one entry per M
        self.latest_clbit_meas_idx = {}  # clbit int -> index into measurement_data

        out = stim.Circuit()
        for q, xy in sorted((q if isinstance(q, int) else self.qubit_map[q], xy) for q, xy in (coords or {}).items()):
            out.append("QUBIT_COORDS", [q], xy)
        self._emit(dag, self.qubit_map, self.clbit_map, out)
        self.circuit = _fold_rounds(out) if fold_rounds else out

    def _emit(self, dag, qmap, cmap, out, tag=""):
        # stim.Circuit.append fuses consecutive same-name (and same-tag) instructions itself.
        for node in consolidate_blocks(dag).topological_op_nodes():
            qs = [qmap[q] for q in node.qargs]
            if node.name in GATES:
                out.append(GATES[node.name], qs, tag=tag)
            elif node.name == "barrier":
                out.append("TICK")
            elif node.name == "measure":
                c = cmap[node.cargs[0]]
                self.latest_clbit_meas_idx[c] = len(self.measurement_data)
                self.measurement_data.append(self.clbit_label.get(c, c))
                out.append("M", qs, tag=tag)
            elif node.name == "if_else":
                self._feedback(node, qmap, cmap, out)
            elif node.name == "for_loop":
                self._loop(node, qmap, cmap, out)
            elif isinstance(node.op, Gate) and (isinstance(node.op, UnitaryGate) or node.name in STANDARD
                                                or node.op.definition is None):
                self._unitary(node.op, qs, out, tag)
            elif node.op.definition is not None:  # composite: unroll, outermost name wins as tag
                dq, dc = self._body_maps(node, node.op.definition, qmap, cmap)
                self._emit(circuit_to_dag(node.op.definition), dq, dc, out, tag or node.name)
            else:
                raise NotImplementedError(f"unsupported gate {node.name!r}")

    @staticmethod
    def _unitary(op, qs, out, tag):
        name = op.label or op.name
        try:
            local = synthesize_unitary(Operator(op).data)
        except ValueError:
            raise NonCliffordGateError(name, qs) from None
        for inst in local:  # elimination output is gates only: remap local 0..k-1 -> global
            out.append(inst.name, [qs[t.value] for t in inst.targets_copy()], inst.gate_args_copy(), tag=tag or name)

    @staticmethod
    def _body_maps(node, body, qmap, cmap):
        return ({b: qmap[o] for b, o in zip(body.qubits, node.qargs)},
                {b: cmap[o] for b, o in zip(body.clbits, node.cargs)})

    def _rec(self, c):
        if c not in self.latest_clbit_meas_idx:
            raise ValueError(f"clbit {c} referenced before being measured")
        return stim.target_rec(self.latest_clbit_meas_idx[c] - len(self.measurement_data))

    def _feedback(self, node, qmap, cmap, out):
        # Qiskit 2.x removed c_if; classical feedback only arrives as IfElseOp.
        op = node.op
        cond = op.condition
        body = op.blocks[0]
        if (len(op.blocks) > 1 or not isinstance(cond, tuple) or not isinstance(cond[0], Clbit) or cond[1] != 1
                or any(inst.operation.name not in FEEDBACK for inst in body.data)):
            raise NotImplementedError("only `if clbit == 1: x/y/z` feedback without else is supported")
        rec = self._rec(cmap[cond[0]])
        if self.strip:  # decoder tracks the Pauli frame instead
            return
        bq, _ = self._body_maps(node, body, qmap, cmap)
        for inst in body.data:
            out.append(FEEDBACK[inst.operation.name], [rec, bq[inst.qubits[0]]])

    def _loop(self, node, qmap, cmap, out):
        indexset, loop_param, body = node.op.params
        if loop_param is not None and loop_param in body.parameters:
            raise NotImplementedError("for_loop bodies that use the loop parameter are not supported")
        bq, bc = self._body_maps(node, body, qmap, cmap)
        bdag = circuit_to_dag(body)

        def iteration():
            c = stim.Circuit()
            self._emit(bdag, bq, bc, c)
            return c

        n = len(indexset)
        iters = [iteration()] if n else []
        for start in (0, 1):  # try REPEAT n, then 1 flat + REPEAT n-1
            if n - start < 2:
                break
            if len(iters) < start + 2:
                iters.append(iteration())
            if iters[start] == iters[start + 1]:  # rec targets are relative => shift-invariant
                for _ in range(n - start - 2):
                    iteration()  # advance the record state
                for it in iters[:start]:
                    out += it
                out.append(stim.CircuitRepeatBlock(n - start, iters[start] + SHIFT))
                return
        while len(iters) < n:
            iters.append(iteration())
        for it in iters:
            out += it


def transpile_to_stim(qc_or_dag, coords=None, strip_in_circuit_feedback=False, fold_rounds=False, detectors=None,
                      observables=None):
    """Translate a QuantumCircuit or DAGCircuit into a stim.Circuit.

    detectors/observables: see detectors.annotate. Passing only observables (even []) infers the detectors;
    passing neither leaves the circuit unannotated.
    """
    t = StimTranspiler(qc_or_dag, coords, strip_in_circuit_feedback, fold_rounds)
    if detectors is None and observables is None:
        return t.circuit
    return annotate(t, detectors, observables)
