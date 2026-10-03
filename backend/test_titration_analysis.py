"""Titration payload assembly does not need a PropKa binary."""

from titration_analysis import assemble_titration, protonated_at_ph, render_titration_png, state_protonation


class _Manager:
    def get_ph_titration_curve(self, ph_range, ph_step):
        self.called = (ph_range, ph_step)
        return {}

    def get_default_protonation_state(self, residue, ph):
        kind = residue["residue"]
        pka = residue["pka"]
        if kind == "ASP":
            return "ASH" if ph < pka else "ASP"
        if kind == "LYS":
            return "LYS" if ph < pka else "LYN"
        if kind == "ARG":
            return "ARG"
        return kind


def test_protonation_rules():
    assert protonated_at_ph(4.0, 6.0) is False
    assert protonated_at_ph(10.5, 6.0) is True
    assert state_protonation("ASH") == 1
    assert state_protonation("ASP") == 0
    assert state_protonation("LYN") == 0


def test_assemble_splits_duplicate_residue_numbers_by_chain():
    residues = [
        {"residue": "ASP", "res_id": 42, "chain": "A", "pka": 4.2},
        {"residue": "ASP", "res_id": 42, "chain": "B", "pka": 5.1},
        {"residue": "LYS", "res_id": 10, "chain": "A", "pka": 10.4},
        {"residue": "LIG", "res_id": 0, "chain": "A", "pka": 3.0},
    ]
    payload = assemble_titration(
        _Manager(),
        residues,
        target_ph=6.0,
        ph_min=5.0,
        ph_max=7.0,
        ph_step=1.0,
    )
    labels = [r["label"] for r in payload["residues"]]
    assert labels == ["ASP42:A", "ASP42:B", "LYS10"]
    by_id = {r["id"]: r for r in payload["residues"]}
    assert by_id["ASP42:A"]["protonated"] is False
    assert by_id["LYS10:A"]["protonated"] is True
    lys = next(c for c in payload["curves"] if c["id"] == "LYS10:A")
    assert lys["ph"] == [5.0, 6.0, 7.0]
    assert lys["y"] == [1.0, 1.0, 1.0]
    asp = next(c for c in payload["curves"] if c["id"] == "ASP42:A")
    assert asp["y"] == [0.0, 0.0, 0.0]


def test_render_titration_png_bytes():
    png = render_titration_png(
        {
            "target_ph": 6,
            "letters": {"a": "A", "b": "B", "c": "C"},
            "types": [
                {
                    "name": "ASP",
                    "color": "#e74c3c",
                    "pka": [3.9, 4.4],
                    "fraction": 0.0,
                    "points": [
                        {"pka": 3.9, "protonated": False},
                        {"pka": 4.4, "protonated": False},
                    ],
                }
            ],
            "curves": [
                {
                    "label": "ASP42",
                    "color": "#e74c3c",
                    "ph": [0, 4, 8, 14],
                    "y": [1, 1, 0, 0],
                }
            ],
            "reference_lines": [
                {"axis": "y", "value": 6, "color": "#e74c3c", "style": "dashed", "label": "pH 6"},
                {"axis": "x", "value": 6, "color": "#e74c3c", "style": "dashed", "label": "pH 6"},
            ],
            "style": {"dpi": 80},
        }
    )
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_titration_png_matches_panel_pixels():
    import struct

    png = render_titration_png(
        {
            "target_ph": 6,
            "types": [
                {
                    "name": "ASP",
                    "color": "#e74c3c",
                    "pka": [4.0],
                    "fraction": 0.0,
                    "points": [{"pka": 4.0, "protonated": False}],
                }
            ],
            "curves": [{"label": "ASP42", "color": "#e74c3c", "ph": [0, 14], "y": [1, 0]}],
            "layout": {
                "pixels": {
                    "a": {"w": 400, "h": 220},
                    "b": {"w": 400, "h": 140},
                    "c": {"w": 500, "h": 364},
                },
                "gap": 4,
                "column_gap": 12,
            },
            "style": {"dpi": 100},
        }
    )
    width, height = struct.unpack(">II", png[16:24])
    assert abs(width - 912) <= 2
    assert abs(height - 364) <= 2
