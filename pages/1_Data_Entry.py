import os, time, pandas as pd, streamlit as st
from datetime import datetime

DATA_FILE = os.path.join("data", "beneficiaries.csv")

st.set_page_config(page_title="YAM Beneficiaries — Data Entry", layout="centered")
st.title("Data Entry — YAM Beneficiaries (Auto-Calc)")

@st.cache_data
def load_lists():
    divisyen = pd.read_csv("data/divisyen.csv")["Divisyen"].tolist()
    negeri   = pd.read_csv("data/negeri.csv")["Negeri/Pusat"].tolist()
    # We don’t use the raw jabatan.csv directly; we’ll drive Jabatan by Divisyen below
    return divisyen, negeri

div_list, neg_list = load_lists()

# ---------- CONFIG ----------
# Which Jabatan are valid for each Divisyen
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
        "Waqaf Quran",
    ],
    "Outreach": [
        "Ziarah Mahabbah",
        "Masjid/Surau/Komuniti",
        "Cawangan Negeri",
        "Pemasaran/Media/Fundraising",
        "Warung Makan Sahabat — Sarapan",
        "Warung Makan Sahabat — Tengah Hari",
    ],
}

# Calculator choices per Divisyen
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
        "Waqaf Quran",
        "Manual",
    ],
    "Outreach": [
        "Warung Makan Sahabat — Sarapan",
        "Warung Makan Sahabat — Tengah Hari",
        "Manual",
    ],
}


# Default calculator by Jabatan (so Program auto-fills when Jabatan changes)
DEFAULT_METHOD_BY_JAB = {
    # Disaster
    "Dapur Rakyat": "Dapur Rakyat",
    "Pek Barangan Asas (Dalam Negara)": "Pek Barangan Asas (Dalam Negara)",
    "Pek Barangan Asas (Luar Negara)": "Pek Barangan Asas (Luar Negara)",
    "Shelter (Dalam Negara)": "Shelter (Dalam Negara)",
    "Shelter (Luar Negara)": "Shelter (Luar Negara)",
    "Rumah Transit": "Rumah Transit",
    "Relief (Misi Bantuan Bencana)": "Dapur Rakyat",  # pick a default you prefer
    "Post-Disaster Rehabilitation": "Manual",

    # Humanitarian
    "Ambulans (Kes Biasa)": "Ambulans (Kes Biasa)",
    "Ambulans (Standby Event)": "Ambulans (Standby Event)",
    "Amal Doctor — Derma Darah": "Amal Doctor — Derma Darah",
    "Amal Doctor — Khatan": "Amal Doctor — Khatan",
    "Amal Doctor — Umum": "Amal Doctor — Umum",
    "AMAL Water4Life": "AMAL Water4Life",
    "Kebajikan": "Manual",

    # H&T
    "Tadika AMAL": "Tadika AMAL",
    "PDS (Pelajar)": "PDS (Pelajar)",
    "TVET / Skills": "Manual",
    "Pembangunan Wanita/Keluarga/Masyarakat": "Manual",
    "Daie Lapangan": "Manual",

    # Enterprise
    "Qurban (Lembu/Kambing/Unta)": "Qurban (Lembu/Kambing/Unta)",
    "Waqaf Quran": "Waqaf Quran",

    # Outreach
    "Ziarah Mahabbah": "Manual",
    "Masjid/Surau/Komuniti": "Manual",
    "Cawangan Negeri": "Manual",
    "Pemasaran/Media/Fundraising": "Manual",
    "Warung Makan Sahabat — Sarapan": "Warung Makan Sahabat — Sarapan",
    "Warung Makan Sahabat — Tengah Hari": "Warung Makan Sahabat — Tengah Hari",
}


FIVE_STATES = {"Selangor","Perak","Wilayah Persekutuan Kuala Lumpur","Negeri Sembilan","Melaka","Johor","Pulau Pinang"}
def five_or_seven(state: str) -> int:
    return 5 if state in FIVE_STATES else 7

def ensure_csv_with_headers():
    headers = [
        "Timestamp","Divisyen","Jabatan","Program (Kaedah)",
        "Negeri/Pusat","Aktiviti","PIC","Lokasi",
        "Bilangan Penerima Manfaat","Belanjawan yang dikeluarkan"
    ]
    if not os.path.exists(DATA_FILE):
        pd.DataFrame(columns=headers).to_csv(DATA_FILE, index=False)

def append_row(row: dict):
    df = pd.read_csv(DATA_FILE) if os.path.exists(DATA_FILE) else pd.DataFrame()
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    df.to_csv(DATA_FILE, index=False)

# ---------- UI (reactive; no st.form so it updates live) ----------

# 1) Context
c1, c2, c3 = st.columns(3)
with c1:
    div = st.selectbox("Divisyen", div_list, key="div")
with c2:
    neg = st.selectbox("Negeri/Pusat", neg_list, key="neg")
with c3:
    belanjawan = st.number_input("Belanjawan yang dikeluarkan (RM)", min_value=0.0, step=0.5, value=0.0, format="%.2f", key="budget")

# 2) Jabatan depends on Divisyen
jab_options = JABATAN_BY_DIV.get(div, [])
# Reset jabatan/program when Divisyen changes
if "last_div" not in st.session_state or st.session_state["last_div"] != div:
    st.session_state["jab"] = jab_options[0] if jab_options else ""
    # set default program based on jabatan
    prog_default = DEFAULT_METHOD_BY_JAB.get(st.session_state["jab"], CALC_CHOICES.get(div, ["Manual"])[0])
    st.session_state["prog"] = prog_default
    st.session_state["last_div"] = div

jab = st.selectbox("Jabatan (mengikut Divisyen)", jab_options, key="jab")

# 3) Program auto-updates when Jabatan changes
prog_options = CALC_CHOICES.get(div, ["Manual"])
prog_auto = DEFAULT_METHOD_BY_JAB.get(jab, prog_options[0])
if "last_jab" not in st.session_state or st.session_state["last_jab"] != jab:
    st.session_state["prog"] = prog_auto if prog_auto in prog_options else prog_options[0]
    st.session_state["last_jab"] = jab

prog = st.selectbox("Program (Kaedah Pengiraan)", prog_options, index=prog_options.index(st.session_state["prog"]))

# 4) General info
c4, c5 = st.columns(2)
with c4:
    aktiviti = st.text_input("Aktiviti (nama/deskripsi)")
    lokasi   = st.text_input("Lokasi")
with c5:
    pic      = st.text_input("PIC (nama atau email)")

st.divider()
st.subheader("Auto-Calculation Inputs")

# 5) Calculator — show inputs based on Program
benef = 0

# DISASTER
if prog == "Dapur Rakyat":
    packs = st.number_input("Jumlah pek/hidangan", min_value=0, step=1, value=0)
    days  = st.number_input("Bilangan hari", min_value=0, step=1, value=0)
    benef = packs * 1 * days

elif prog == "Pek Barangan Asas (Dalam Negara)":
    packs = st.number_input("Jumlah pek (dalam negara)", min_value=0, step=1, value=0)
    benef = packs * five_or_seven(neg) * 7

elif prog == "Pek Barangan Asas (Luar Negara)":
    packs = st.number_input("Jumlah pek (luar negara)", min_value=0, step=1, value=0)
    days  = st.number_input("Anggaran bilangan hari", min_value=0, step=1, value=0)
    benef = packs * 7 * days

elif prog == "Shelter (Dalam Negara)":
    tents = st.number_input("Jumlah khemah", min_value=0, step=1, value=0)
    days  = st.number_input("Jumlah hari", min_value=0, step=1, value=0)
    benef = tents * 5 * days

elif prog == "Shelter (Luar Negara)":
    tents = st.number_input("Jumlah khemah", min_value=0, step=1, value=0)
    days  = st.number_input("Jumlah hari", min_value=0, step=1, value=0)
    benef = tents * 10 * days

elif prog == "Rumah Transit":
    family = st.number_input("Jumlah isi keluarga", min_value=0, step=1, value=0)
    days   = st.number_input("Jumlah hari", min_value=0, step=1, value=0)
    benef = family * days

# HUMANITARIAN
elif prog == "Ambulans (Kes Biasa)":
    patients = st.number_input("Jumlah pesakit", min_value=0, step=1, value=0)
    benef = patients * five_or_seven(neg)

elif prog == "Ambulans (Standby Event)":
    crowd = st.number_input("Anggaran crowd program", min_value=0, step=1, value=0)
    benef = int(crowd * 0.60)

elif prog == "Amal Doctor — Derma Darah":
    bags = st.number_input("Jumlah beg darah", min_value=0, step=1, value=0)
    benef = bags * 3 * five_or_seven(neg)

elif prog == "Amal Doctor — Khatan":
    participants = st.number_input("Jumlah peserta", min_value=0, step=1, value=0)
    benef = participants * 3

elif prog == "Amal Doctor — Umum":
    patients = st.number_input("Jumlah pesakit", min_value=0, step=1, value=0)
    benef = patients

elif prog == "AMAL Water4Life":
    families = st.number_input("Bilangan keluarga", min_value=0, step=1, value=0)
    benef = families * 10 * 365

# H&T
elif prog == "Tadika AMAL":
    students = st.number_input("Bilangan pelajar", min_value=0, step=1, value=0)
    benef = students * 200 * 3

elif prog == "PDS (Pelajar)":
    students = st.number_input("Bilangan pelajar PDS", min_value=0, step=1, value=0)
    benef = int(students * 750 * 0.20)

# ENTERPRISE
elif prog == "Qurban (Lembu/Kambing/Unta)":
    qtype = st.selectbox("Jenis haiwan", ["Lembu","Kambing","Unta"])
    ekor  = st.number_input("Jumlah ekor", min_value=0, step=1, value=0)
    factor = {"Lembu":500,"Kambing":70,"Unta":600}[qtype]
    benef = ekor * factor
    
elif prog == "Waqaf Quran":
    naskhah = st.number_input("Jumlah naskhah Al-Quran", min_value=0, step=1, value=0)
    benef = naskhah * 6

# OUTREACH
elif prog == "Warung Makan Sahabat — Sarapan":
    pek_per_hari = st.number_input("Jumlah pek (per hari)", min_value=0, step=1, value=0)
    benef = pek_per_hari * 26 * 12

elif prog == "Warung Makan Sahabat — Tengah Hari":
    pek_per_hari = st.number_input("Jumlah pek (per hari)", min_value=0, step=1, value=0)
    benef = pek_per_hari * 26 * 12
    
else:  # Manual / default
    benef = st.number_input("Bilangan Penerima Manfaat (manual)", min_value=0, step=1, value=0)

# 6) Live KPI (updates before submit)
st.metric("Benefisiari dikira", f"{int(benef):,}")

# 7) Submit button (appends to CSV)
if st.button("Hantar / Submit"):
    if not lokasi or not aktiviti or not pic:
        st.error("Sila lengkapkan Lokasi, Aktiviti dan PIC.")
    else:
        ensure_csv_with_headers()
        new_row = {
            "Timestamp": datetime.now().isoformat(timespec="seconds"),
            "Divisyen": div,
            "Jabatan": jab,
            "Program (Kaedah)": prog,
            "Negeri/Pusat": neg,
            "Aktiviti": aktiviti,
            "PIC": pic,
            "Lokasi": lokasi,
            "Bilangan Penerima Manfaat": int(benef),
            "Belanjawan yang dikeluarkan": float(st.session_state.get("budget", 0.0)),
        }
        append_row(new_row)
        st.success(f"Rekod berjaya dihantar! Benefisiari = {int(benef):,}")
        time.sleep(0.4)
        st.rerun()
