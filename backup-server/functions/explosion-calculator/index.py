"""
Расчёт параметров воздушных ударных волн при взрывах.

POST: {
  method: "gas_dynamics"  (режим "fnip_494" удалён, принимается для старых проектов),
  sourceType: "gas" | "mass",
  gasId, gasVolume_m3, gasConcentration,
  explosiveId, explosiveMass_kg,
  excavationArea_m2, excavationLength_m,
  ambientPressure_kPa, considerWalls,
  distances: [r1, r2, ...]   — опционально, давление в точках
}
"""
import json, math

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

Q_TNT   = 4520.0   # кДж/кг — теплота взрыва ТНТ
P0      = 101.3    # кПа    — атмосферное давление
C0      = 340.0    # м/с    — скорость звука

# unit — единица концентрации, у газов и пыли она РАЗНАЯ:
#   "vol%" — объёмные проценты, qCombust в МДж/м3 (газы)
#   "g/m3" — граммы на кубометр, qCombust в МДж/кг (аэровзвесь пыли)
# Раньше пыль хранилась с пределами 60...400 и считалась как проценты: при
# концентрации 200 выходило 200 м3 горючего в 100 м3 смеси, то есть горючего
# вдвое больше, чем всей смеси, и Q_тнт завышался в сотни раз.
GAS_TYPES = {
    "methane":   {"unit": "vol%", "qCombust": 33.8, "lowerLimit": 5.0, "upperLimit": 15.0, "stoichConc": 9.5},
    "hydrogen":  {"unit": "vol%", "qCombust": 10.8, "lowerLimit": 4.0, "upperLimit": 75.0, "stoichConc": 29.5},
    "propane":   {"unit": "vol%", "qCombust": 93.2, "lowerLimit": 2.1, "upperLimit": 9.5,  "stoichConc": 4.0},
    "acetylene": {"unit": "vol%", "qCombust": 56.0, "lowerLimit": 2.5, "upperLimit": 80.0, "stoichConc": 7.7},
    # Угольная пыль: НПВ ~30 г/м3, ВПВ ~2000 г/м3, максимум при 300-500 г/м3,
    # теплота сгорания каменного угля ~22 МДж/кг.
    "coal_dust": {"unit": "g/m3", "qCombust": 22.0, "lowerLimit": 30,  "upperLimit": 2000, "stoichConc": 400},
}


def conc_unit_label(unit):
    return "г/м3" if unit == "g/m3" else "%"

# Коэффициент участия Z (Методика №415, прил. по ТВС):
#   0.1 — дефлаграция в открытом пространстве,
#   0.5 — взрыв в замкнутом/загромождённом объёме (горная выработка).
Z_OPEN     = 0.1
Z_CONFINED = 0.5
Z_DEFAULT  = Z_CONFINED

# Коэффициенты Садовского дают ΔP в кгс/см² — переводим в кПа
KGF_CM2_TO_KPA = 98.07

# Нижняя граница применимости формулы Садовского: приведённое расстояние
# r̄ = r/Q^(1/3) = 1. Ближе к заряду формула расходится, параметры волны
# методикой не определяются — принимается значение на границе.
R_BAR_MIN = 1.0

# ВВ задаётся ОДНИМ параметром — удельной теплотой взрыва, кДж/кг.
# Тротиловый эквивалент вычисляется из неё: k = q_ВВ / q_ТНТ (Методика №415).
# Раньше хранились два независимых числа, причём qSpec в расчёте не
# участвовал, а tntEq был с ним не согласован (аммонит: q=3700, k=0.97,
# хотя из этой теплоты следует k=0.82).
EXPLOSIVE_TYPES = {
    "tnt":       {"qSpec": 4520},
    "ammonit":   {"qSpec": 4312},
    "granulite": {"qSpec": 4290},
    "igdanit":   {"qSpec": 3810},
    "anfo":      {"qSpec": 3700},
    "emulsion":  {"qSpec": 3000},
    "custom":    {"qSpec": 4520},
}


def tnt_equivalent(expl):
    """Тротиловый эквивалент ВВ: k = q_ВВ / q_ТНТ."""
    return round(expl["qSpec"] / Q_TNT, 2)

# Пороги зон поражения, кПа. Ряд различается в разных документах, поэтому
# задаётся в справочнике и приходит в запросе полем "thresholds".
# "safe" — НЕ порог классификации точки, а граница безопасной зоны:
# расстояние, дальше которого воздействие пренебрежимо мало (как в «Аэросети»).
HAZARD_THRESHOLDS = {"lethal": 100, "heavy": 50, "medium": 30, "light": 10, "safe": 5.99}


def normalize_thresholds(raw):
    """Пороги из запроса -> корректный убывающий ряд."""
    d = HAZARD_THRESHOLDS
    raw = raw if isinstance(raw, dict) else {}

    def take(key, fallback, cap=None):
        v = raw.get(key)
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = 0.0
        if v <= 0:
            v = fallback
        return min(v, cap) if cap is not None else v

    lethal = take("lethal", d["lethal"])
    heavy  = take("heavy",  d["heavy"],  lethal)
    medium = take("medium", d["medium"], heavy)
    light  = take("light",  d["light"],  medium)
    safe   = take("safeLimit", d["safe"], light)
    return {"lethal": lethal, "heavy": heavy, "medium": medium, "light": light, "safe": safe}


def gas_to_tnt(gas, volume_m3, concentration, z=Z_DEFAULT):
    """m_пр = (q_г / q_ТНТ) · m · Z  (Методика №415, прил. по ТВС).

    Газ и пыль считаются по-разному — разная единица концентрации:
      газ  (vol%): объём горючего = V·c/100,  энергия = объём · МДж/м3
      пыль (g/m3): масса пыли     = V·c/1000, энергия = масса · МДж/кг
    """
    if gas.get("unit") == "g/m3":
        e_chem = (volume_m3 * concentration / 1000.0) * gas["qCombust"]
    else:
        e_chem = (volume_m3 * concentration / 100.0) * gas["qCombust"]
    e_mech = e_chem * z * 1000
    return e_mech / Q_TNT


def sadovsky_delta_p(r_m, q_tnt):
    """ΔP во фронте по Садовскому, кПа. Ограничена границей применимости.

    Ближе r̄ = 1 формула расходится: на 1 м от заряда 95 кг она давала
    72 500 кПа, на 0.5 м — 555 700 кПа. Прежняя отсечка `r_bar < 0.1 ->
    10000` не спасала, а вносила разрыв: при r̄ = 0.1001 выходило
    726 350 кПа, при r̄ = 0.0999 — сразу 10 000, то есть ближе к заряду
    давление оказывалось МЕНЬШЕ, чем дальше от него.
    Внутри границы принимаем значение на самой границе (плато).
    """
    if q_tnt <= 0 or r_m <= 0:
        return 0.0
    r_bar = max(r_m / (q_tnt ** (1.0 / 3.0)), R_BAR_MIN)
    # Коэффициенты Садовского дают кгс/см² — переводим в кПа (×98.07)
    dp_kgf = 0.84 / r_bar + 2.7 / r_bar**2 + 7.15 / r_bar**3
    return round(dp_kgf * KGF_CM2_TO_KPA, 1)


def sadovsky_impulse(r_m, q_tnt):
    """Импульс положительной фазы, Па·с — по Методике №415: i = 123·m^0.66/r.

    Коэффициент 123 из той же методики, что и формула давления. Прежний
    коэффициент 200 (другая редакция формулы, иные единицы) завышал
    импульс ровно на 68 % на всех расстояниях.

    Ограничен той же границей применимости: 123·m^0.66/r при r -> 0
    растёт неограниченно.
    """
    if q_tnt <= 0 or r_m <= 0:
        return 0.0
    r = max(r_m, min_valid_radius(q_tnt))
    return round(123 * q_tnt ** 0.66 / r, 1)


def min_valid_radius(q_tnt):
    """Наименьшее расстояние, на котором применима формула Садовского, м.

    Граница — приведённое расстояние r̄ = r/Q^(1/3) = 1. Ближе к заряду
    члены 1/r̄² и 1/r̄³ растут неограниченно и дают величины без
    физического смысла (для 97 кг при r=1 м выходило 74 000 кПа).
    """
    if q_tnt <= 0:
        return 0.0
    return round(q_tnt ** (1.0 / 3.0), 2)


def wave_front_speed(delta_p_kpa):
    return round(C0 * math.sqrt(1 + (6.0 / 7.0) * (delta_p_kpa / P0)), 1)


# Опорные точки коэффициента отражения от стенок выработки (сечение, к).
# Чем уже выработка, тем сильнее канализируется волна.
WALL_FACTOR_POINTS = [(5, 2.0), (15, 1.8), (30, 1.5), (50, 1.3)]


def wall_reflection_factor(area_m2):
    """Коэффициент отражения от стенок — ПЛАВНЫЙ (линейная интерполяция).

    Раньше коэффициент был ступенчатым (<10 -> 2.0, <20 -> 1.8, <40 -> 1.5,
    иначе 1.3): 19.9 м2 давало 1.8, а 20.0 м2 — уже 1.5, то есть изменение
    сечения на 0.1 м2 роняло давление на 17 % и двигало границы зон.
    """
    if area_m2 <= 0:
        return 1.5
    pts = WALL_FACTOR_POINTS
    if area_m2 <= pts[0][0]:
        return pts[0][1]
    if area_m2 >= pts[-1][0]:
        return pts[-1][1]
    for (a1, k1), (a2, k2) in zip(pts, pts[1:]):
        if area_m2 <= a2:
            t = (area_m2 - a1) / (a2 - a1)
            return round(k1 + (k2 - k1) * t, 3)
    return pts[-1][1]


def hazard_level(dp, th=None):
    th = th or HAZARD_THRESHOLDS
    if dp >= th["lethal"]: return "lethal"
    if dp >= th["heavy"]:  return "heavy"
    if dp >= th["medium"]: return "medium"
    if dp >= th["light"]:  return "light"
    return "safe"


def radius_at_pressure(target_p, q_tnt, method, wall_factor):
    # method не используется: осталась одна методика (см. pressure_at)
    if target_p <= 0 or q_tnt <= 0:
        return 0
    lo, hi = 0.1, 5000.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        dp = sadovsky_delta_p(mid, q_tnt) * wall_factor
        if dp > target_p:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2.0)


def pressure_at(r, q_tnt, method, wall_factor):
    # method оставлен в сигнатуре для совместимости со старыми вызовами:
    # режим "fnip_494" удалён, расчёт всегда газодинамический (Садовский).
    # r = 0 (точка установки очага) — это максимум, а не ноль: ветка
    # `r_m <= 0` в sadovsky_delta_p давала 0 кПа, и эпицентр взрыва
    # попадал в зону «безопасно».
    return round(sadovsky_delta_p(max(r, min_valid_radius(q_tnt)), q_tnt) * wall_factor, 1)


def calc_one(body: dict) -> dict:
    """Расчёт одного взрыва по его исходным данным. Возвращает готовый результат."""
    method       = body.get("method", "gas_dynamics")
    source_type  = body.get("sourceType", "gas")
    area_m2      = float(body.get("excavationArea_m2", 12))
    consider_walls = bool(body.get("considerWalls", True))
    distances    = body.get("distances", [])
    th           = normalize_thresholds(body.get("thresholds"))

    log = []
    warnings = []

    # 1. Тротиловый эквивалент
    q_tnt = 0.0
    if source_type == "gas":
        gas_id  = body.get("gasId", "methane")
        gas     = GAS_TYPES.get(gas_id, GAS_TYPES["methane"])
        volume  = float(body.get("gasVolume_m3", 100))
        conc    = float(body.get("gasConcentration", 9.5))
        u = conc_unit_label(gas.get("unit"))
        if conc < gas["lowerLimit"]:
            warnings.append(f"Концентрация {conc} {u} ниже НПВ ({gas['lowerLimit']} {u}) — смесь не взрывоопасна")
        elif conc > gas["upperLimit"]:
            warnings.append(f"Концентрация {conc} {u} выше ВПВ ({gas['upperLimit']} {u}) — смесь не взрывоопасна")
        # Обогащённая смесь: горючего больше стехиометрии — не хватает
        # кислорода, энергия ограничена окислителем.
        eff_conc = min(conc, gas["stoichConc"])
        z = float(body.get("zParticipation") or Z_DEFAULT)
        if z <= 0:
            z = Z_DEFAULT
        q_tnt = gas_to_tnt(gas, volume, eff_conc, z)
        log.append(f"{'Пыль' if gas.get('unit') == 'g/m3' else 'Газ'}: {gas_id}, объём: {volume} м³, концентрация: {conc} {u}")
        if eff_conc < conc:
            log.append(f"Смесь обогащённая: в расчёт принята стехиометрическая концентрация {eff_conc} {u}")
        log.append(f"Коэффициент участия Z (Методика №415): {z}")
    else:
        expl_id = body.get("explosiveId", "ammonit")
        expl    = EXPLOSIVE_TYPES.get(expl_id, EXPLOSIVE_TYPES["ammonit"])
        mass_kg = float(body.get("explosiveMass_kg", 10))
        k_tnt   = tnt_equivalent(expl)
        q_tnt   = mass_kg * k_tnt
        log.append(f"ВВ: {expl_id}, масса: {mass_kg} кг, Q_уд = {expl['qSpec']} кДж/кг")
        log.append(f"Тротиловый эквивалент: k = {expl['qSpec']} / {Q_TNT:.0f} = {k_tnt}")

    if q_tnt <= 0:
        warnings.append("Тротиловый эквивалент = 0 — расчёт невозможен")
        q_tnt = 0.001

    q_tnt_rounded = round(q_tnt * 100) / 100
    log.append(f"Тротиловый эквивалент: Q_tnt = {q_tnt_rounded} кг ТНТ")

    # 2. Коэффициент выработки
    wall_factor = wall_reflection_factor(area_m2) if consider_walls else 1.0
    if consider_walls:
        log.append(f"Коэффициент отражения от стенок: k = {wall_factor}")

    # 3. Параметры в эпицентре (r=1м)
    # Максимум — на ГРАНИЦЕ ПРИМЕНИМОСТИ формулы (r̄ = 1), а не при r = 1 м:
    # для 97 кг ТНТ r = 1 м это r̄ = 0.22, где формула уже не работает.
    r_min    = min_valid_radius(q_tnt)
    max_dp   = pressure_at(r_min, q_tnt, method, wall_factor)
    max_imp  = round(sadovsky_impulse(r_min, q_tnt) * wall_factor, 1)
    wave_spd = wave_front_speed(max_dp)

    log.append("Методика: газодинамическая (Садовский), Q_тнт по Методике №415")
    log.append(f"Граница применимости формулы: r̄ = 1, то есть r = {r_min} м")
    log.append(f"Максимальное давление во фронте (r = {r_min} м): ΔP = {max_dp} кПа")
    log.append(f"Скорость фронта: D = {wave_spd} м/с")

    # 4. Зоны поражения
    # Зоны строятся из порогов справочника, а не из зашитых чисел.
    zone_defs = [
        ("Летальная",         "lethal", th["lethal"], None,         "летальный исход, полное разрушение"),
        ("Тяжёлые поражения", "heavy",  th["heavy"],  th["lethal"], "тяжёлые травмы, обрушение"),
        ("Средние поражения", "medium", th["medium"], th["heavy"],  "средние травмы, повреждение"),
        ("Лёгкие поражения",  "light",  th["light"],  th["medium"], "контузии, лёгкие повреждения"),
    ]
    zones = []
    for name, hlevel, lo, hi, what in zone_defs:
        r = radius_at_pressure(lo, q_tnt, method, wall_factor)
        imp = round(sadovsky_impulse(r, q_tnt) * wall_factor, 1) if r > 0 else 0
        rng = f"> {lo}" if hi is None else f"{lo}–{hi}"
        zones.append({"name": name, "description": f"ΔP {rng} кПа — {what}",
                      "radius_m": r, "deltaP_kPa": lo, "impulse_Pas": imp,
                      "hazardLevel": hlevel})
        log.append(f"{name}: r = {r} м, ΔP = {lo} кПа")
    r_safe = radius_at_pressure(th["safe"], q_tnt, method, wall_factor)
    zones.append({"name": "Безопасная зона",
                  "description": f"ΔP < {th['safe']} кПа — незначительное воздействие",
                  "radius_m": r_safe, "deltaP_kPa": th["safe"],
                  "impulse_Pas": round(sadovsky_impulse(r_safe, q_tnt) * wall_factor, 1) if r_safe > 0 else 0,
                  "hazardLevel": "safe"})
    log.append(f"Безопасная зона: r = {r_safe} м, ΔP = {th['safe']} кПа")

    # 5. Давление в произвольных точках (опционально)
    pressure_points = []
    for r in distances:
        dp = pressure_at(float(r), q_tnt, method, wall_factor)
        imp = round(sadovsky_impulse(float(r), q_tnt) * wall_factor, 1)
        pressure_points.append({"r_m": r, "deltaP_kPa": dp, "impulse_Pas": imp,
                                 "hazardLevel": hazard_level(dp, th)})

    result = {
        "q_tnt_kg":           q_tnt_rounded,
        "maxDeltaP_kPa":      max_dp,
        "maxImpulse_Pas":     max_imp,
        "waveFrontSpeed_ms":  wave_spd,
        "minValidRadius_m":   r_min,
        "thresholds":         th,
        "zones":              zones,
        "pressurePoints":     pressure_points,
        "log":                log,
        "warnings":           warnings,
    }
    return result


def handler(event: dict, context) -> dict:
    """Расчёт параметров воздушной ударной волны при взрыве (Садовский, Q_тнт по Методике №415)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = json.loads(event.get("body") or "{}")

    # ПАКЕТНЫЙ РЕЖИМ. Раньше программа отправляла ОТДЕЛЬНЫЙ запрос на каждое
    # место взрыва: пять очагов на схеме — пять обращений к серверу, и так при
    # каждом нажатии «Рассчитать». Теперь все очаги можно посчитать одним
    # запросом: {"items": [ {...}, {...} ]} → {"results": [ {...}, {...} ]}.
    # Расчёт быстрый и полностью на процессоре, поэтому пачка считается за то
    # же время, что и один взрыв.
    items = body.get("items")
    if isinstance(items, list):
        results = [calc_one(it if isinstance(it, dict) else {}) for it in items[:200]]
        return {"statusCode": 200, "headers": CORS,
                "body": json.dumps({"results": results}, ensure_ascii=False)}

    # Одиночный расчёт — прежний формат, чтобы ничего не сломать.
    return {"statusCode": 200, "headers": CORS,
            "body": json.dumps(calc_one(body), ensure_ascii=False)}