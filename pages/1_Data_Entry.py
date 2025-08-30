import os, time, pandas as pd, streamlit as st
from datetime import datetime

DATA_FILE = os.path.join("data", "beneficiaries.csv")

st.set_page_config(page_title="YAM Beneficiaries — Data Entry", layout="centered")
st.title("Data Entry — YAM Beneficiaries (Auto-Calc)")

@st.cache_data
def load_lists():
    divisyen = pd.read_csv("data/divisyen.csv")["Divisyen"].tolist()
    jabatan  = pd.read_csv("data/jabatan.csv")["Jabatan"].tolist()
    negeri   = pd.read_csv("data/negeri.csv")["Negeri/Pusat"].tolist()
    return divisyen, jabatan, negeri

div_list, jab_list_all, neg_list = load_lists()

# ----- CONFIG: map Divisyen -> allowed Jabatan & calculator options -----
JABATAN_BY_DIV = {
    "Disaster Management": [
        "Dapur Rakyat",
        "Pek Barangan Asas (Dalam Negara)",
        "Pek Barangan Asas (Luar Negara)",
        "Shelter (Dalam Negara)",
        "Shelter (Luar Negara)",
        "Rumah Transit",
        "Relief (Misi Bantuan Bencana)",
        "Post-Disaster Rehabilitation",
    ],
    "Humanitarian": [
        "Ambulans (Kes Biasa)",
        "Ambulans (Standby Event)",
        "Amal Doctor — Derma Darah",
        "Amal Doctor — Khatan",
        "Amal Doctor — Umum",
        "AMAL Water4Life",
        "Kebajikan",
    ],
    "Human & Talent Development": [
        "Tadika AMAL",
        "PDS (Pelajar)",
        "TVET / Skills",
        "Pembangunan Wanita/Keluarga/Masyarakat",
        "Daie Lapangan",
    ],
    "Enterprise": [
        "Qurban (Lembu/Kambing/Unta)",
    ],
    "Outreach": [
        "Ziarah Mahabbah",
        "Masjid/Surau/Komuniti",
        "Cawangan Negeri",
        "Pemasaran/Media/Fundraising",
    ],
}

CALC_CHOICES = {
    "Disaster Management": [
        "Dapur Rakyat",
        "Pek Barangan Asas (Dalam Negara)",
        "Pek Barangan Asas (Luar Negara)",
        "Shelter (Dalam Negara)",
        "Shelter (Luar Negara)",
        "Rumah Transit",
        "Manual",
    ],
    "Humanitarian": [
        "Ambulans (Kes Biasa)",
        "Ambulans (Standby Event)",
        "Amal Doctor — Derma Darah",
        "Amal Doctor — Khatan",
        "Amal Doctor — Umum",
        "AMAL Water4Life",
        "Manual",
    ],
    "Human & Talent Development": [
        "Tadika AMAL",
        "PDS (Pelajar)",
        "Manual",
    ],
    "Enterprise": [
        "Qurban (Lembu/Kambing/Unta)",
        "Manual",
    ],
    "Outreach": ["Manual"],
}

FIVE_STATES = {"Selangor","Perak","Wilayah Persekutuan Kuala Lumpur","Negeri Sembilan","Melaka","Johor","Pulau Pinang"}
def five_or_seven(state: str) -> int:
    return 5 if state in FIVE_STATES else 7

def ensure_csv_with_headers():
    headers = ["Timestamp","Divisyen","Jabatan","Negeri/Pusat","Aktiviti","PIC","Lokasi",
               "Bilangan Penerima Manfaat","Belanjawan yang dikeluarkan"]
    if not os.path.exists(DATA_FILE):
        pd.DataFrame(columns=headers).to_csv(DATA_FILE, index=False)

def append_row(row: dict):
    df = pd.read_csv(DATA_FILE) if os.path.exists(DATA_FILE) else pd.DataFrame()
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    df.to_csv(DATA_FILE, index=False)

# ---------- STEP 1: pick context (outside the form so UI refreshes immediately) ----------
st.subheader("Langkah 1 — Pilih konteks")
colA, colB, colC = st.columns(3)
with colA:
    div = st.selectbox("Divisyen", div_list, key="divisyen")
with colB:
    neg = st.selectbox("Negeri/Pusat", neg_list, key="negeri")
with colC:
    calc_options = CALC_CHOICES.get(div, ["Manual"])
    calc_method = st.selectbox("Kaedah Pengiraan (Program)", calc_options, key="calc_method")

# Filter Jabatan based on Divisyen
jab_options = JABATAN_BY_DIV.get(div, [])
# (Optional) merge with any extra labels from CSV that match the divisyen pattern if you want
if not jab_options:
    jab_options = jab_list_all  # fallback to all

# ---------- STEP 2: the actual form ----------
st.subheader("Langkah 2 — Isi maklumat & kiraan")
with st.form("beneficiary_form"):
    c1, c2 = st.columns(2)
    with c1:
        jab = st.selectbox("Jabatan/Program (label organisasi)", jab_options, key="jabatan")
        lokasi = st.text_input("Lokasi")
    with c2:
        aktiviti = st.text_input("Aktiviti (nama program / deskripsi ringkas)")
        pic = st.text_input("PIC (nama atau email)")
        belanjawan = st.number_input("Belanjawan yang dikeluarkan (RM)", min_value=0.0, step=0.5, value=0.0, format="%.2f")

    st.divider()
    st.subheader("Auto-Calculation Inputs")

    # ---- calculators ----
    benef = 0

    # DISASTER
    if calc_method == "Dapur Rakyat":
        packs = st.number_input("Jumlah pek/hidangan", min_value=0, step=1, value=0)
        days  = st.number_input("Bilangan hari", min_value=0, step=1, value=0)
        benef = packs * 1 * days

    elif calc_method == "Pek Barangan Asas (Dalam Negara)":
        packs = st.number_input("Jumlah pek (dalam negara)", min_value=0, step=1, value=0)
        benef = packs * five_or_seven(neg) * 7

    elif calc_method == "Pek Barangan Asas (Luar Negara)":
        packs = st.number_input("Jumlah pek (luar negara)", min_value=0, step=1, value=0)
        days  = st.number_input("Anggaran bilangan hari", min_value=0, step=1, value=0)
        benef = packs * 7 * days

    elif calc_method == "Shelter (Dalam Negara)":
        tents = st.number_input("Jumlah khemah", min_value=0, step=1, value=0)
        days  = st.number_input("Jumlah hari", min_value=0, step=1, value=0)
        benef = tents * 5 * days

    elif calc_method == "Shelter (Luar Negara)":
        tents = st.number_input("Jumlah khemah", min_value=0, step=1, value=0)
        days  = st.number_input("Jumlah hari", min_value=0, step=1, value=0)
        benef = tents * 10 * days

    elif calc_method == "Rumah Transit":
        family = st.number_input("Jumlah isi keluarga", min_value=0, step=1, value=0)
        days   = st.number_input("Jumlah hari", min_value=0, step=1, value=0)
        benef = family * days

    # HUMANITARIAN
    elif calc_method == "Ambulans (Kes Biasa)":
        patients = st.number_input("Jumlah pesakit", min_value=0, step=1, value=0)
        benef = patients * five_or_seven(neg)

    elif calc_method == "Ambulans (Standby Event)":
        crowd = st.number_input("Anggaran crowd program", min_value=0, step=1, value=0)
        benef = int(crowd * 0.60)

    elif calc_method == "Amal Doctor — Derma Darah":
        bags = st.number_input("Jumlah beg darah", min_value=0, step=1, value=0)
        benef = bags * 3 * five_or_seven(neg)

    elif calc_method == "Amal Doctor — Khatan":
        participants = st.number_input("Jumlah peserta", min_value=0, step=1, value=0)
        benef = participants * 3

    elif calc_method == "Amal Doctor — Umum":
        patients = st.number_input("Jumlah pesakit", min_value=0, step=1, value=0)
        benef = patients

    elif calc_method == "AMAL Water4Life":
        families = st.number_input("Bilangan keluarga", min_value=0, step=1, value=0)
        benef = families * 10 * 365

    # HUMAN & TALENT
    elif calc_method == "Tadika AMAL":
        students = st.number_input("Bilangan pelajar", min_value=0, step=1, value=0)
        benef = students * 200 * 3

    elif calc_method == "PDS (Pelajar)":
        students = st.number_input("Bilangan pelajar PDS", min_value=0, step=1, value=0)
        benef = int(students * 750 * 0.20)

    # ENTERPRISE
    elif calc_method == "Qurban (Lembu/Kambing/Unta)":
        qtype = st.selectbox("Jenis haiwan", ["Lembu","Kambing","Unta"])
        ekor = st.number_input("Jumlah ekor", min_value=0, step=1, value=0)
        factor = {"Lembu":500,"Kambing":70,"Unta":600}[qtype]
        benef = ekor * factor

    else:  # Manual / default
        benef = st.number_input("Bilangan Penerima Manfaat (manual)", min_value=0, step=1, value=0)

    st.info(f"📊 Benefisiari dikira: **{int(benef):,}**")

    submitted = st.form_submit_button("Hantar / Submit")

if submitted:
    if not st.session_state.get("jabatan") or not neg or not st.session_state.get("divisyen"):
        st.error("Sila pilih Divisyen, Negeri/Pusat dan Jabatan.")
    elif not st.session_state.get("calc_method"):
        st.error("Sila pilih Kaedah Pengiraan.")
    else:
        aktiviti = st.session_state.get("Aktiviti") if "Aktiviti" in st.session_state else ""
        # we already hold aktiviti, pic, lokasi, belanjawan in local vars from the form above
        ensure_csv_with_headers()
        new_row = {
            "Timestamp": datetime.now().isoformat(timespec="seconds"),
            "Divisyen": st.session_state["divisyen"],
            "Jabatan": st.session_state["jabatan"],
            "Negeri/Pusat": st.session_state["negeri"],
            "Aktiviti": aktiviti,
            "PIC": st.session_state.get("PIC", ""),
            "Lokasi": st.session_state.get("Lokasi", ""),
            "Bilangan Penerima Manfaat": int(benef),
            "Belanjawan yang dikeluarkan": float(st.session_state.get("belanjawan", 0.0)) if "belanjawan" in st.session_state else 0.0,
        }
        # but to be safe, append using the local variables captured above:
        new_row.update({
            "Aktiviti": aktiviti,
        })
        # Append using simpler values we still have in scope
        append_row({
            "Timestamp": datetime.now().isoformat(timespec="seconds"),
            "Divisyen": st.session_state["divisyen"],
            "Jabatan": st.session_state["jabatan"],
            "Negeri/Pusat": st.session_state["negeri"],
            "Aktiviti": aktiviti,
            "PIC": st.session_state.get("PIC",""),
            "Lokasi": st.session_state.get("Lokasi","") or "",
            "Bilangan Penerima Manfaat": int(benef),
            "Belanjawan yang dikeluarkan": float(belanjawan),
        })
        st.success(f"Rekod berjaya dihantar! Benefisiari = {int(benef):,}")
        time.sleep(0.4)
        st.rerun()
