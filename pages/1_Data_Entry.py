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

div_list, jab_list, neg_list = load_lists()

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

# Map Divisyen -> calculator choices
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
    "Humanitarian (legacy name)": ["Manual"],  # just in case
}

with st.form("beneficiary_form"):
    c1, c2 = st.columns(2)

    with c1:
        div = st.selectbox("Divisyen", div_list, index=div_list.index("Disaster Management") if "Disaster Management" in div_list else 0)
        jab = st.selectbox("Jabatan/Program (label organisasi)", jab_list)
        neg = st.selectbox("Negeri/Pusat", neg_list)
        lokasi = st.text_input("Lokasi")
    with c2:
        aktiviti = st.text_input("Aktiviti (nama program / deskripsi ringkas)")
        pic = st.text_input("PIC (nama atau email)")
        belanjawan = st.number_input("Belanjawan yang dikeluarkan (RM)", min_value=0.0, step=0.5, value=0.0, format="%.2f")

    st.divider()
    st.subheader("Auto-Calculation Inputs")

    # pick a calculation method based on Divisyen
    calc_options = CALC_CHOICES.get(div, ["Manual"])
    calc_method = st.selectbox("Kaedah Pengiraan (Program)", calc_options, index=0)

    benef = 0
    if calc_method == "Dapur Rakyat":
        packs = st.number_input("Jumlah pek/hidangan", min_value=0, step=1, value=0)
        days  = st.number_input("Bilangan hari", min_value=0, step=1, value=0)
        benef = packs * 1 * days

    elif calc_method == "Pek Barangan Asas (Dalam Negara)":
        packs = st.number_input("Jumlah pek (dalam negara)", min_value=0, step=1, value=0)
        mult  = five_or_seven(neg)
        st.caption(f"Multiplier negeri = {mult} (5 untuk {', '.join(sorted(FIVE_STATES))}; 7 untuk negeri lain). Tempoh = 7 hari.")
        benef = packs * mult * 7

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

    elif calc_method == "Tadika AMAL":
        students = st.number_input("Bilangan pelajar", min_value=0, step=1, value=0)
        benef = students * 200 * 3

    elif calc_method == "PDS (Pelajar)":
        students = st.number_input("Bilangan pelajar PDS", min_value=0, step=1, value=0)
        benef = int(students * 750 * 0.20)

    elif calc_method == "Qurban (Lembu/Kambing/Unta)":
        qtype = st.selectbox("Jenis haiwan", ["Lembu","Kambing","Unta"])
        ekor = st.number_input("Jumlah ekor", min_value=0, step=1, value=0)
        factor = {"Lembu":500,"Kambing":70,"Unta":600}[qtype]
        benef = ekor * factor

    else:  # Manual
        benef = st.number_input("Bilangan Penerima Manfaat (manual)", min_value=0, step=1, value=0)

    st.info(f"📊 Benefisiari dikira: **{int(benef):,}**")
    submitted = st.form_submit_button("Hantar / Submit")

if submitted:
    # basic validation
    if not lokasi or not aktiviti or not pic:
        st.error("Sila lengkapkan Lokasi, Aktiviti, dan PIC.")
    else:
        ensure_csv_with_headers()
        new_row = {
            "Timestamp": datetime.now().isoformat(timespec="seconds"),
            "Divisyen": div,
            "Jabatan": jab,
            "Negeri/Pusat": neg,
            "Aktiviti": aktiviti,
            "PIC": pic,
            "Lokasi": lokasi,
            "Bilangan Penerima Manfaat": int(benef),
            "Belanjawan yang dikeluarkan": float(belanjawan),
        }
        append_row(new_row)
        st.success(f"Rekod berjaya dihantar! Benefisiari = {int(benef):,}")
        time.sleep(0.4)
        st.rerun()
