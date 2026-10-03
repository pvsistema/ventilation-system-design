"""Ударная воздушная волна при взрыве заряда ВВ в подземной выработке —
ФНП № 494 (приказ Ростехнадзора от 03.12.2020), пп. 816–822, прил. 29.

ΔP = (3410·Qэ/(R·ΣS) + 794·√(Qэ/(R·ΣS)))·e^(−β·R/d), кПа   (ф. 22)
d = 1,12·√S                                               (ф. 23)
Для пород IX группы и выше (f = 12…20) — ×1,5. Для людей — не более 10 кПа.
Та же формула, что в src/lib/fnp494Blast.ts — результаты обязаны совпадать.
"""
import math

REF = "ФНП № 494 (приказ Ростехнадзора от 03.12.2020), пп. 816–822, прил. 28–30"
PEOPLE_KPA = 10.0
HARD_ROCK_K = 1.5

# Прил. 29: (название, β min, β max). В тексте приказа для «по простиранию»
# напечатано 0.25 — опечатка, принято 0,025.
SUPPORTS = {
    "unsupported_strike":     ("Без крепи, пройдена по простиранию", 0.02, 0.025),
    "unsupported_cross_up":   ("Без крепи, вкрест простирания, волна против падения", 0.04, 0.045),
    "unsupported_cross_down": ("Без крепи, вкрест простирания, волна по падению", 0.022, 0.028),
    "uneven_hatches":         ("Неровная почва и люки", 0.045, 0.063),
    "concrete":               ("Крепь бетоном", 0.010, 0.015),
    "partial_frames":         ("Неполные крепёжные рамы", 0.025, 0.034),
    "arch":                   ("Арочная крепь", 0.04, 0.06),
    "shotcrete":              ("Торкретбетон", 0.02, 0.025),
    "arch_hatches":           ("Арочная крепь с люками для выпуска руды", 0.05, 0.07),
}


def make_source(q_kg, q_tnt, area_m2, sum_s=None, support="arch", bound="min", hard_rock=False):
    area = area_m2 if area_m2 and area_m2 > 0 else 12.0
    sid = support if support in SUPPORTS else "arch"
    name, bmin, bmax = SUPPORTS[sid]
    return {
        "Q_kg": q_kg,
        "sumS_m2": sum_s if sum_s and sum_s > 0 else 2 * area,
        "area_m2": area,
        "d_m": 1.12 * math.sqrt(area),
        "beta": bmax if bound == "max" else bmin,
        "support": sid,
        "betaBound": "max" if bound == "max" else "min",
        "kRock": HARD_ROCK_K if hard_rock else 1.0,
        "rMin_m": max(1.0, max(q_kg, 0.0) ** (1.0 / 3.0)),
        "qTnt_kg": q_tnt,
    }


def support_name(src):
    return SUPPORTS.get(src["support"], SUPPORTS["arch"])[0]


def base(r_m, src):
    if src["Q_kg"] <= 0 or src["sumS_m2"] <= 0:
        return 0.0
    r = max(r_m, src["rMin_m"], 0.1)
    x = src["Q_kg"] / (r * src["sumS_m2"])
    return (3410 * x + 794 * math.sqrt(x)) * src["kRock"]


def pressure_at(r_m, src):
    r = max(r_m, src["rMin_m"])
    att = math.exp(-src["beta"] * r / src["d_m"]) if src["d_m"] > 0 else 1.0
    return round(base(r, src) * att, 1)


def impulse_at(r_m, src):
    """Справочно: Садовский i = 200·Q_тнт^⅔/R с тем же затуханием, Па·с."""
    if src["qTnt_kg"] <= 0:
        return 0.0
    r = max(r_m, src["rMin_m"])
    att = math.exp(-src["beta"] * r / src["d_m"]) if src["d_m"] > 0 else 1.0
    return round(200 * src["qTnt_kg"] ** (2.0 / 3.0) / r * att * src["kRock"], 1)


def distance_at_pressure(p_kpa, src):
    if p_kpa <= 0:
        return 0
    if pressure_at(src["rMin_m"], src) <= p_kpa:
        return round(src["rMin_m"])
    lo, hi = src["rMin_m"], 20000.0
    if pressure_at(hi, src) > p_kpa:
        return int(hi)
    for _ in range(80):
        m = (lo + hi) / 2
        if pressure_at(m, src) > p_kpa:
            lo = m
        else:
            hi = m
    return round((lo + hi) / 2)
