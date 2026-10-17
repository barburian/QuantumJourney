import warnings
from types import SimpleNamespace

import pytest
import stim
from qiskit.transpiler import PassManager

from qec_bridge import (FaultDistanceWarning, QECResult, StimTranslationPass, UnityQNoiseProfile, add_noise, build_dem,
                        check_distance, compile_qec, make_sinter_tasks, run_sweep, simulate, transpile_to_stim)
from qec_bridge import decoding
from test_phase4_decoding import HYPEREDGE, rep, scaled


def noisy_rep(d):
    qc, fin, _ = rep(d)
    return add_noise(transpile_to_stim(qc, observables=[[fin[0]]]), scaled(3))


def test_compile_qec_matches_pipeline():
    qc, fin, _ = rep()
    r = compile_qec(qc, observables=[[fin[0]]], noise=UnityQNoiseProfile(), shots=2000, seed=5, target_distance=3)
    want = add_noise(transpile_to_stim(qc, observables=[[fin[0]]]), UnityQNoiseProfile())
    assert r.circuit == want and r.dem == build_dem(want)
    assert r.matcher is decoding._decoder(str(r.dem))
    assert r.report == simulate(want, 2000, seed=5)
    assert compile_qec(qc, observables=[[fin[0]]]).report is None


def test_graph_export():
    pytest.importorskip("networkx")
    qc, fin, _ = rep()
    r = compile_qec(qc, observables=[[fin[0]]], noise=UnityQNoiseProfile())
    g = r.to_networkx()
    assert g.number_of_nodes() == r.dem.num_detectors + 1  # pymatching adds one boundary node
    assert r.matcher.to_networkx().number_of_nodes() == g.number_of_nodes()


def test_hyperedge_has_no_graph(monkeypatch):
    decoding._decoder.cache_clear()
    monkeypatch.setattr(decoding, "_bposd", lambda dem: SimpleNamespace())  # stand-in for the BP-OSD decoder
    dem = build_dem(HYPEREDGE)
    r = QECResult(HYPEREDGE, dem, decoding._decoder(str(dem)))
    with pytest.raises(ValueError, match="hyperedges"):
        r.to_networkx()
    decoding._decoder.cache_clear()


def test_pass_manager_plugin():
    qc, fin, _ = rep()
    pm = PassManager([StimTranslationPass(observables=[[fin[0]]])])
    pm.run(qc)
    assert pm.property_set["stim_circuit"] == transpile_to_stim(qc, observables=[[fin[0]]])
    assert isinstance(pm.property_set["stim_dem"], stim.DetectorErrorModel)
    pm = PassManager([StimTranslationPass(observables=[[fin[0]]], noise=UnityQNoiseProfile())])
    pm.run(qc)
    assert pm.property_set["stim_dem"] == build_dem(add_noise(transpile_to_stim(qc, observables=[[fin[0]]])))


@pytest.mark.parametrize("d", [3, 5])
def test_check_distance(d, tmp_path):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        assert check_distance(noisy_rep(d), d, out_dir=tmp_path) == d
    assert not list(tmp_path.iterdir())


def test_check_distance_warns_and_dumps(tmp_path):
    c = noisy_rep(3)
    bad = stim.Circuit("E(0.001) X0 X1") + c  # correlated flip of two data qubits: X2 completes a logical
    with pytest.warns(FaultDistanceWarning, match="2 < target 3"):
        assert check_distance(bad, 3, out_dir=tmp_path / "diag") == 2
    assert (tmp_path / "diag" / "timeslice.svg").read_text().startswith("<svg")
    assert "<html" in (tmp_path / "diag" / "matchgraph.html").read_text().lower()


def test_sinter_sweep():
    pytest.importorskip("sinter")
    tasks = make_sinter_tasks((noisy_rep(d), {"d": d}) for d in (3, 5))
    stats = run_sweep(tasks, max_shots=100, num_workers=1)
    assert sorted(s.json_metadata["d"] for s in stats) == [3, 5]
    assert all(s.shots == 100 and s.decoder == "pymatching" for s in stats)
