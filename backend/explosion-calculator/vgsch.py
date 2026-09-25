"""
Расчёт УВВ при взрывах газов и пыли в горных выработках по «Методике
определения параметров ударных воздушных волн при взрывах газов и пыли
в горных выработках» (Приложение 12 к Уставу ВГСЧ, 27.06.1997 № 175/107).

Зеркало src/lib/vgschBlast.ts — формулы и константы совпадают один в один.
"""
import math

RHO0 = 1.13          # кг/м3 — плотность стехиометрической метановоздушной смеси
GV = 2.763e6         # Дж/кг — удельная теплота взрыва смеси
P0_PA = 1e5          # Па — атмосферное давление в формуле (2)
ZONE1_KPA = 1600.0   # кПа — давление в зоне загазования (детонация)
DUST_K = 1.3         # множитель энергии при участии пыли
PV_FACTOR = 5        # объём продуктов взрыва = 5·V0
SAFE_KPA = 9.0       # кПа — безопасное давление для человека
SAFE_IMPULSE = 40000 # Н·с/м2 — безопасный импульс
C_PRODUCTS = 680.0   # м/с — скорость звука в продуктах взрыва
ALPHA_DEFAULT = 150  # ×10^-4 Н·с2/м4 — «другие виды крепи»

COMBUSTION_MODES = {
    "detonation":        {"label": "Детонация (экстремальный режим)",       "mu": 0.50, "dust": False},
    "deflagration":      {"label": "Дефлаграция без участия пыли",          "mu": 0.15, "dust": False},
    "deflagration_dust": {"label": "Дефлаграция с участием пыли",           "mu": 0.25, "dust": True},
    "layered_dust":      {"label": "Слоевое скопление ГВС с участием пыли", "mu": 0.08, "dust": True},
}


def combustion_mode(mode_id):
    key = mode_id if mode_id in COMBUSTION_MODES else "detonation"
    return key, COMBUSTION_MODES[key]


def kz_from_alpha(alpha):
    """Коэффициент затухания Кз по табл. 3 (A в ×10^-4 Н·с2/м4)."""
    a = alpha if alpha and alpha > 0 else ALPHA_DEFAULT
    if a <= 39.2:
        return 0.5e-3
    if a <= 78.4:
        return 1e-3
    if a <= 196:
        return 2e-3
    if a <= 343:
        return 3e-3
    return 4e-3


def perimeter_of(area, perimeter=None):
    if perimeter and perimeter > 0:
        return perimeter
    return 4 * math.sqrt(area) if area > 0 else 0.0


def initial_pressure_mpa(en_j, v0, mu):
    """Формула (2): ΔPн = 0,7 / (3·(√(1 + 7,12·P0·V2/(μ·Ен)) − 1)), V2 = 5V0, МПа."""
    if en_j <= 0 or v0 <= 0 or mu <= 0:
        return 0.0
    v2 = PV_FACTOR * v0
    root = math.sqrt(1 + 7.12 * P0_PA * v2 / (mu * en_j))
    return 0.7 / (3 * (root - 1))


def zone2_det_kpa(v0, v2):
    """Формула (4) табл. 1: ΔP = (12,3·V0/V2 + 0,5)·10^5 Па → кПа."""
    return (12.3 * v0 / v2 + 0.5) * 100


def make_source(zone_len, v0, mode_id, energy_rel, dust, area, perimeter=None, alpha=None):
    key, m = combustion_mode(mode_id)
    dust_factor = DUST_K if (dust or m["dust"]) else 1.0
    en = RHO0 * GV * v0 * energy_rel * dust_factor
    dpn = initial_pressure_mpa(en, v0, m["mu"]) * 1000
    ref = zone2_det_kpa(1, PV_FACTOR)
    k = dpn / ref if dpn > 0 else 0.0
    return {
        "zoneLength_m": zone_len,
        "V0_m3": v0,
        "mode": key,
        "mu": m["mu"],
        "En_MJ": en / 1e6,
        "dustFactor": dust_factor,
        "dPz_kPa": ZONE1_KPA * k,
        "dPn_kPa": dpn,
        "k": k,
        "pvVolumePerSide_m3": (PV_FACTOR - 1) / 2 * v0,
        "phase_s": max(zone_len / 2, 0.5) / C_PRODUCTS,
        "area_m2": area,
        "perimeter_m": perimeter_of(area, perimeter),
        "kz": kz_from_alpha(alpha),
    }


def zone2_kpa(src, vs):
    v2 = src["V0_m3"] + 2 * max(vs, 0)
    return zone2_det_kpa(src["V0_m3"], v2) * src["k"]


def pressure_at(l_m, src):
    half = src["zoneLength_m"] / 2
    l = max(l_m, 0)
    if l <= half:
        return round(src["dPz_kPa"], 1)
    s = src["area_m2"] if src["area_m2"] > 0 else 1
    vs = (l - half) * s
    if vs < src["pvVolumePerSide_m3"]:
        return round(zone2_kpa(src, vs), 1)
    x = (vs - src["pvVolumePerSide_m3"]) / s
    return round(src["dPn_kPa"] * math.exp(-src["kz"] * src["perimeter_m"] * x / s), 1)


def impulse_at(l_m, src):
    """Импульс по правилу методики: i = ΔP·θ/2, Н·с/м2."""
    return round(pressure_at(l_m, src) * 1000 * src["phase_s"] / 2, 1)


def distance_at_pressure(p, src):
    if p <= 0 or src["dPz_kPa"] <= 0 or p > src["dPz_kPa"]:
        return 0
    half = src["zoneLength_m"] / 2
    s = src["area_m2"] if src["area_m2"] > 0 else 1
    if p >= zone2_kpa(src, 0):
        return round(half)
    if p >= src["dPn_kPa"]:
        r = p / (100 * src["k"]) - 0.5
        v2 = 12.3 * src["V0_m3"] / r if r > 0 else PV_FACTOR * src["V0_m3"]
        vs = min((v2 - src["V0_m3"]) / 2, src["pvVolumePerSide_m3"])
        return round(half + vs / s)
    n = src["kz"] * src["perimeter_m"] / s
    x = math.log(src["dPn_kPa"] / p) / n if n > 0 else 0
    return round(half + src["pvVolumePerSide_m3"] / s + x)
