"""Phase 5b: fault-distance check with diagram dumps for circuits that fall short."""
import os
import warnings


class FaultDistanceWarning(UserWarning):
    """The noisy circuit has a graphlike logical error shorter than the target distance."""


def check_distance(noisy_circuit, target_distance, out_dir=None):
    """Graphlike circuit distance; warns and (if out_dir) writes timeslice.svg/matchgraph.html when < target."""
    d = len(noisy_circuit.shortest_graphlike_error())
    if d < target_distance:
        warnings.warn(FaultDistanceWarning(f"graphlike circuit distance {d} < target {target_distance}"), stacklevel=2)
        if out_dir is not None:
            os.makedirs(out_dir, exist_ok=True)
            for name, kind in [("timeslice.svg", "timeslice-svg"), ("matchgraph.html", "matchgraph-3d-html")]:
                with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
                    f.write(str(noisy_circuit.diagram(kind)))
    return d
