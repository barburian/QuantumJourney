"""QARW: circuit builder + qec_bridge in one Streamlit app: streamlit run app.py"""
import streamlit as st

st.set_page_config(page_title="QARW", layout="wide")
st.navigation([st.Page("blueprints_app.py", title="Circuit builder"),
               st.Page("qec_app.py", title="QEC bridge")]).run()
