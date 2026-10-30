"""Embeds the built QuantumBlueprints app (blueprints/dist)."""
import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

dist = Path(__file__).parent / "blueprints" / "dist"
if not (dist / "index.html").exists():
    st.error("Circuit builder not built yet: cd blueprints && npm install && npm run build")
    st.stop()


def asset(m):
    return (dist / m[1]).read_text(encoding="utf-8")


# components.html is a srcdoc iframe that can't fetch ./assets/*, so inline the bundle
html = (dist / "index.html").read_text(encoding="utf-8")
html = re.sub(r'<script type="module" crossorigin src="\./([^"]+)"></script>',
              lambda m: f'<script type="module">{asset(m)}</script>', html)
html = re.sub(r'<link rel="stylesheet" crossorigin href="\./([^"]+)">',
              lambda m: f'<style>{asset(m)}</style>', html)
components.html(html, height=850)
