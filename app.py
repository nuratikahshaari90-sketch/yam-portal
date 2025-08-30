import os, pandas as pd, numpy as np, plotly.express as px, streamlit as st
DATA_FILE = os.path.join("data", "beneficiaries.csv")

st.set_page_config(page_title="YAM Beneficiaries — Dashboard", layout="wide")
st.title("YAM Beneficiaries — Dashboard")

@st.cache_data(ttl=60)
def load_data(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        return pd.DataFrame(columns=[
            "Timestamp","Divisyen","Jabatan","Negeri/Pusat","Aktiviti","PIC",
            "Lokasi","Bilangan Penerima Manfaat","Belanjawan yang dikeluarkan"
        ])
    df = pd.read_csv(path)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
    df["Month"] = df["Timestamp"].dt.to_period("M").astype(str)
    for c in ["Bilangan Penerima Manfaat","Belanjawan yang dikeluarkan"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    return df

if st.sidebar.button("Reload data"):
    st.cache_data.clear()

df = load_data(DATA_FILE)

# Filters
st.sidebar.title("Filters")
months = sorted(df["Month"].dropna().unique().tolist())
m_sel = st.sidebar.multiselect("Month(s)", months, default=months)
if m_sel:
    df = df[df["Month"].isin(m_sel)]

for col, label in [("Divisyen","Divisyen"), ("Jabatan","Jabatan"), ("Negeri/Pusat","Negeri/Pusat")]:
    options = sorted(df[col].dropna().unique().tolist())
    sel = st.sidebar.multiselect(label, options, default=options)
    if sel:
        df = df[df[col].isin(sel)]

# KPIs
total_benef = int(df["Bilangan Penerima Manfaat"].sum()) if not df.empty else 0
total_budget = float(df["Belanjawan yang dikeluarkan"].sum()) if not df.empty else 0.0
c1,c2 = st.columns(2)
c1.metric("Total Beneficiaries", f"{total_benef:,}")
c2.metric("Cumulative Budget (RM)", f"{total_budget:,.2f}")

if df.empty:
    st.info("No data yet. Go to **Data Entry** (left sidebar ▶ Pages) to add records.")
else:
    # Charts
    by_div = df.groupby("Divisyen", as_index=False).agg(
        Beneficiaries=("Bilangan Penerima Manfaat","sum"),
        Budget=("Belanjawan yang dikeluarkan","sum")
    )
    st.plotly_chart(px.bar(by_div, x="Divisyen", y="Beneficiaries",
                           title="Beneficiaries by Divisyen"), use_container_width=True)

    by_jab = df.groupby("Jabatan", as_index=False).agg(
        Beneficiaries=("Bilangan Penerima Manfaat","sum"),
        Budget=("Belanjawan yang dikeluarkan","sum")
    ).sort_values("Beneficiaries", ascending=False).head(20)
    st.plotly_chart(px.bar(by_jab, x="Jabatan", y="Beneficiaries",
                           title="Top Jabatan by Beneficiaries"), use_container_width=True)

    by_neg = df.groupby("Negeri/Pusat", as_index=False).agg(
        Beneficiaries=("Bilangan Penerima Manfaat","sum"),
        Budget=("Belanjawan yang dikeluarkan","sum")
    )
    st.plotly_chart(px.bar(by_neg, x="Negeri/Pusat", y="Beneficiaries",
                           title="Beneficiaries by Negeri/Pusat"), use_container_width=True)

    # Detail
    st.subheader("Detail (Filtered)")
    st.dataframe(df.sort_values("Timestamp", ascending=False), use_container_width=True)
    st.download_button("Download filtered CSV",
                       df.to_csv(index=False).encode("utf-8"),
                       "beneficiaries_filtered.csv","text/csv")
