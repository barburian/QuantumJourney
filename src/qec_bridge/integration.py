"""Phase 5a: one-call compile, Qiskit PassManager pass and sinter threshold sweeps."""
from dataclasses import dataclass

import pymatching
import stim
from qiskit.transpiler.basepasses import AnalysisPass

from .decoding import _decoder, build_dem, simulate
from .diagnostics import check_distance
from .noise import add_noise
from .transpiler import transpile_to_stim


@dataclass
class QECResult:
    """compile_qec output. matcher is the cached Phase-4 decoder: a pymatching.Matching for graphlike DEMs, a
    BP-OSD decoder (no graph) when the DEM has hyperedges, in which case to_networkx() raises ValueError."""
    circuit: stim.Circuit
    dem: stim.DetectorErrorModel
    matcher: object
    report: dict = None

    def to_networkx(self):
        if not isinstance(self.matcher, pymatching.Matching):
            raise ValueError("the DEM has hyperedges (decoded with BP-OSD), so there is no matching graph to export")
        return self.matcher.to_networkx()


def compile_qec(qc, detectors=None, observables=None, noise=None, shots=None, seed=None, target_distance=None):
    """transpile_to_stim -> add_noise (if noise) -> build_dem -> decoder, plus simulate(shots, seed) if shots and
    check_distance if target_distance."""
    circuit = transpile_to_stim(qc, detectors=detectors, observables=observables)
    if noise is not None:
        circuit = add_noise(circuit, noise)
    if target_distance is not None:
        check_distance(circuit, target_distance)
    dem = build_dem(circuit)
    report = simulate(circuit, shots, seed=seed) if shots else None
    return QECResult(circuit, dem, _decoder(str(dem)), report)


class StimTranslationPass(AnalysisPass):
    """Stores property_set["stim_circuit"] (noisy if noise) and property_set["stim_dem"]."""

    def __init__(self, detectors=None, observables=None, noise=None):
        super().__init__()
        self.detectors, self.observables, self.noise = detectors, observables, noise

    def run(self, dag):
        circuit = transpile_to_stim(dag, detectors=self.detectors, observables=self.observables)
        if self.noise is not None:
            circuit = add_noise(circuit, self.noise)
        self.property_set["stim_circuit"] = circuit
        self.property_set["stim_dem"] = build_dem(circuit)


def make_sinter_tasks(circuits_with_metadata):
    """[(stim.Circuit, metadata dict)] -> [sinter.Task] carrying the dict as json_metadata."""
    import sinter

    return [sinter.Task(circuit=c, json_metadata=m) for c, m in circuits_with_metadata]


def run_sweep(tasks, max_shots, max_errors=None, num_workers=1):
    """sinter.collect with pymatching; returns the list of sinter.TaskStats."""
    import sinter

    return sinter.collect(num_workers=num_workers, tasks=tasks, decoders=["pymatching"], max_shots=max_shots,
                          max_errors=max_errors)
