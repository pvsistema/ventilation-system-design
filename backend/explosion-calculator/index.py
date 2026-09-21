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
from license_guard import license_gate

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
}

Q_TNT   = 4520.0   # кДж/кг — теплота взрыва ТНТ
P0      = 101.3    # кПа    — атмосферное давление
C0      = 340.0    # м/с    — скорость звука в холодном воздухе
# Скорость звука в ПРОДУКТАХ сгорания (нагреты до ~2000 K): вдвое выше C0.
C_PRODUCTS = 680.0

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
    return round(sadovsky_delta_p_raw(r_m, q_tnt), 1)


def sadovsky_delta_p_raw(r_m, q_tnt):
    """То же без округления — для внутренних расчётов канальной модели."""
    if q_tnt <= 0 or r_m <= 0:
        return 0.0
    r_bar = max(r_m / (q_tnt ** (1.0 / 3.0)), R_BAR_MIN)
    # Коэффициенты Садовского дают кгс/см² — переводим в кПа (×98.07)
    dp_kgf = 0.84 / r_bar + 2.7 / r_bar**2 + 7.15 / r_bar**3
    return dp_kgf * KGF_CM2_TO_KPA


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


# ─── КАНАЛЬНАЯ МОДЕЛЬ РАСПРОСТРАНЕНИЯ ────────────────────────────────────────
# Формула Садовского описывает СФЕРИЧЕСКИЙ разлёт в открытом воздухе. В горной
# выработке волна уже через несколько метров упирается в стенки и дальше идёт
# по КАНАЛУ: энергия в объём не рассеивается, давление падает только на трении
# о стенки и делении потока на сопряжениях.
#
# Разница не в процентах, а в порядках: для 95 кг ТНТ в выработке 12 м²
# сфера давала границу 6 кПа на 127 м, канал — на 650 м, что согласуется
# с «Аэросетью». Прежний wall_reflection_factor этого не лечил: он умножал
# давление на постоянное число и не менял сам ЗАКОН затухания.
#
#   1) Ближняя зона (r <= r_tr) — сфера по Садовскому.
#   2) r_tr = K_TRANSITION * sqrt(S) — фронт заполнил сечение.
#   3) Дальняя зона — ΔP(L) = ΔP(r_tr) * exp(-beta * (L - r_tr)),
#      beta = lambda / (2 * d_g),  d_g = 4S/P.

K_TRANSITION = 2.0

# Коэффициент сопротивления для ЗАТУХАНИЯ УДАРНОЙ ВОЛНЫ (не стационарного
# трения!). Волна проходит выработку за доли секунды, пограничный слой
# развиться не успевает, потери на порядок ниже. Прежние 0.05 (как для
# установившегося потока) гасили волну втрое быстрее реального.
#   0.005…0.01 — гладкие бетонные стволы;
#   0.015…0.025 — типовые выработки с арочной крепью (по умолчанию 0.02);
#   0.03…0.05  — сильно загромождённые.
LAMBDA_DEFAULT = 0.02

# Начальное избыточное давление продуктов взрыва газовоздушной смеси
# в замкнутом объёме, кПа. В «Аэросети» считается АВТОМАТИЧЕСКИ по длине
# загазованного участка — у нас так же (см. gas_initial_pressure).
GAS_P0_DEFAULT = 282.0

# ΔP0 зависит от ДЛИНЫ участка И от ЭНЕРГИИ смеси:
#     ΔP0 = K * L^n * (E_v / E_v_ref)
# Физика: давление в замкнутом объёме определяется удельным энерговыделением
# E_v, а длина добавляет разгон фронта пламени на турбулентности от стенок
# (с насыщением, а не линейно).
#
# Раньше формула была ΔP0 = K*L^n без энергии, и это разрывало цепочку: вид
# газа, концентрация и Z считались, но на зоны поражения не влияли вообще —
# смесь 5.5 % давала те же зоны, что стехиометрическая 9.5 %.
#
# Калибровка по «Аэросети» сохранена: множитель равен 1 для эталона (метан
# 9.5 % при Z=0.5), поэтому L=50 м -> 209 кПа, L=100 м -> 282 кПа.
GAS_P0_COEF = 38.5358
GAS_P0_EXP = 0.43219

# Эталон: метан 9.5 %, Z=0.5 -> 33.8 * 0.095 * 0.5 = 1.6055 МДж/м3 смеси
GAS_EV_REF = 1.6055


def gas_energy_density(gas, concentration, z):
    """Удельная энергия смеси, МДж на кубометр СМЕСИ.

    Учитывает: (1) сгорает только стехиометрическая доля — остального
    кислорода не хватает; (2) непрореагировавший избыток работает
    БАЛЛАСТОМ, поглощает тепло и снижает давление; (3) коэффициент Z.
    """
    if concentration <= 0 or z <= 0:
        return 0.0
    burned = min(concentration, gas["stoichConc"])
    if gas.get("unit") == "g/m3":
        e = (burned / 1000.0) * gas["qCombust"]   # кг пыли в м3 x МДж/кг
    else:
        e = (burned / 100.0) * gas["qCombust"]    # м3 газа в м3 смеси x МДж/м3
    ballast = (gas["stoichConc"] / concentration) if concentration > gas["stoichConc"] else 1.0
    return e * ballast * z


def gas_initial_pressure(zone_len, energy_density=None):
    """ΔP0 в очаге по длине участка и удельной энергии смеси, кПа.

    energy_density не задана — берётся эталонная, то есть формула
    вырождается в прежнюю зависимость только от длины.

    Ограничения: 20 кПа снизу (короткий участок не разгоняет пламя),
    900 кПа сверху — предел давления продуктов сгорания углеводородо-
    воздушной смеси в замкнутом объёме (около 9 атмосфер).
    """
    if zone_len is None or zone_len <= 0:
        return 0.0
    ev = energy_density if energy_density and energy_density > 0 else GAS_EV_REF
    p = GAS_P0_COEF * (zone_len ** GAS_P0_EXP) * (ev / GAS_EV_REF)
    return round(min(900.0, max(20.0, p)), 1)


# ─── ГАЗОВАЯ МОДЕЛЬ: ПЛОСКАЯ ВОЛНА ОТ ЗАГАЗОВАННОГО УЧАСТКА ─────────────────
# Для ВВ источник — компактный заряд, волна сначала расходится шаром, и
# формула Садовского уместна. Для газа источник другой: ПРОТЯЖЁННЫЙ
# загазованный участок на всё сечение выработки. Волна там плоская с самого
# начала, сферического разлёта нет.
#
# Прежний расчёт применял к газу сферическую ближнюю зону, и уже на
# r_tr = 2*sqrt(S) ≈ 7 м от 35 кг ТНТ оставалось 174 кПа вместо 1046 — то есть
# 85 % энергии «терялось» в первых семи метрах ещё до входа в канал.
#
#   • внутри участка (L <= L_газ/2 от центра) давление постоянно = ΔP0;
#   • за границей — ΔP(L) = ΔP0 * exp(-beta * (L - L_газ/2)).


def gas_pressure_at(l_m, zone_len, p0, area_m2, perimeter_m=None, lam=None, path_factor=1.0):
    """ΔP плоской волны на расстоянии L от ЦЕНТРА загазованного участка, кПа."""
    if p0 <= 0:
        return 0.0
    half = max(zone_len, 0) / 2.0
    l = max(l_m, 0)
    if l <= half:
        return round(p0 * path_factor, 1)
    beta = channel_decay(area_m2, perimeter_m, lam)
    return round(p0 * math.exp(-beta * (l - half)) * path_factor, 1)


def gas_phase_duration(zone_len):
    """Длительность фазы сжатия для газового взрыва, с.

    Это время разгрузки загазованного участка: волна разрежения идёт от
    границы очага вглубь со скоростью звука в ПРОДУКТАХ (они нагреты до
    ~2000 K, c ~ 680 м/с). Очаг разгружается в обе стороны, поэтому берётся
    полудлина: tau = (L/2) / c_прод.

    ПРЕЖНЯЯ ОШИБКА: стояло tau = L / C0 — полная длина, делённая на скорость
    звука в ХОЛОДНОМ воздухе. Это давало вчетверо завышенную длительность
    (для L=100 м — 294 мс вместо 73.5 мс) и такой же завышенный импульс.
    """
    return max(max(zone_len, 0) / 2.0, 0.5) / C_PRODUCTS


def tnt_phase_duration(r_m, q_tnt):
    """Длительность фазы сжатия для компактного заряда (ВВ), с.

    Выводится из определения импульса: tau = i / ΔP. Обе величины из
    Методики №415, поэтому новый источник данных не вводится.
    """
    dp = sadovsky_delta_p_raw(r_m, q_tnt)
    if dp <= 0:
        return 0.0
    return sadovsky_impulse(r_m, q_tnt) / (dp * 1000.0)


def gas_impulse_at(l_m, zone_len, p0, area_m2, perimeter_m=None, lam=None, path_factor=1.0):
    """Импульс плоской волны, Па·с: i = ΔP * tau.

    У газа импульс на порядки больше, чем у ВВ, и это не ошибка: компактный
    заряд даёт короткий удар (единицы мс), газовая дефлаграция работает как
    длинный поршень (десятки мс). Длительность возвращается отдельным полем
    phaseDuration_ms, чтобы разница была видна явно.
    """
    if p0 <= 0:
        return 0.0
    half = max(zone_len, 0) / 2.0
    i0 = p0 * 1000 * gas_phase_duration(zone_len)
    l = max(l_m, 0)
    if l <= half:
        return round(i0 * path_factor, 1)
    beta = channel_decay(area_m2, perimeter_m, lam) * 0.5
    return round(i0 * math.exp(-beta * (l - half)) * path_factor, 1)


def gas_distance_at_pressure(target_p, zone_len, p0, area_m2, perimeter_m=None, lam=None, path_factor=1.0):
    """Длина пути от центра очага, на которой ΔP падает до заданного, м."""
    p = p0 * path_factor
    if target_p <= 0 or p <= 0:
        return 0
    half = max(zone_len, 0) / 2.0
    if target_p >= p:
        return round(half)
    beta = channel_decay(area_m2, perimeter_m, lam)
    if beta <= 0:
        return round(half)
    return round(half + math.log(p / target_p) / beta)


def hydraulic_diameter(area_m2, perimeter_m=None):
    """Гидравлический диаметр выработки d = 4S/P, м."""
    if area_m2 <= 0:
        return 0.0
    p = perimeter_m if perimeter_m and perimeter_m > 0 else 2 * math.sqrt(math.pi * area_m2)
    return (4 * area_m2) / p


def channel_decay(area_m2, perimeter_m=None, lam=None):
    """Погонный декремент затухания beta, 1/м: ΔP(x) = ΔP0 * exp(-beta*x).

    Чем УЖЕ выработка, тем быстрее гаснет волна — выше отношение периметра
    к площади, больше потери на трении на каждом метре. Это противоположно
    прежней логике wall_reflection_factor, где узкая выработка просто
    усиливала давление постоянным множителем.
    """
    d = hydraulic_diameter(area_m2, perimeter_m)
    if d <= 0:
        return 0.0
    lam = lam if lam and lam > 0 else LAMBDA_DEFAULT
    return lam / (2 * d)


def transition_radius(area_m2):
    """Расстояние перехода сфера -> канал, м."""
    if area_m2 <= 0:
        return 0.0
    return K_TRANSITION * math.sqrt(area_m2)


def channel_pressure_at(l_m, q_tnt, area_m2, perimeter_m=None, lam=None, path_factor=1.0):
    """ΔP на расстоянии L по выработке, кПа. Непрерывна в точке сшивки."""
    if q_tnt <= 0:
        return 0.0
    r_min = R_BAR_MIN * (q_tnt ** (1.0 / 3.0))
    r_tr = max(transition_radius(area_m2), r_min)
    l = max(l_m, r_min)
    if l <= r_tr:
        return round(sadovsky_delta_p_raw(l, q_tnt) * path_factor, 1)
    dp_tr = sadovsky_delta_p_raw(r_tr, q_tnt)
    beta = channel_decay(area_m2, perimeter_m, lam)
    return round(dp_tr * math.exp(-beta * (l - r_tr)) * path_factor, 1)


def channel_impulse_at(l_m, q_tnt, area_m2, perimeter_m=None, lam=None, path_factor=1.0):
    """Импульс на расстоянии L по выработке, Па·с.

    В канале импульс затухает медленнее давления (фаза сжатия растягивается),
    поэтому декремент берётся половинный.
    """
    if q_tnt <= 0:
        return 0.0
    r_min = R_BAR_MIN * (q_tnt ** (1.0 / 3.0))
    r_tr = max(transition_radius(area_m2), r_min)
    l = max(l_m, r_min)
    base = 123 * q_tnt ** 0.66
    if l <= r_tr:
        return round((base / l) * path_factor, 1)
    beta = channel_decay(area_m2, perimeter_m, lam) * 0.5
    return round((base / r_tr) * math.exp(-beta * (l - r_tr)) * path_factor, 1)


def channel_distance_at_pressure(target_p, q_tnt, area_m2, perimeter_m=None, lam=None, path_factor=1.0):
    """Длина пути по выработке, на которой ΔP падает до заданного, м."""
    if target_p <= 0 or q_tnt <= 0:
        return 0
    r_min = R_BAR_MIN * (q_tnt ** (1.0 / 3.0))
    r_tr = max(transition_radius(area_m2), r_min)
    dp_tr = sadovsky_delta_p_raw(r_tr, q_tnt) * path_factor
    if target_p >= dp_tr:
        # Порог достигается ещё в сферической зоне
        if sadovsky_delta_p_raw(r_min, q_tnt) * path_factor <= target_p:
            return round(r_min)
        lo, hi = r_min, r_tr
        for _ in range(60):
            mid = (lo + hi) / 2.0
            if sadovsky_delta_p_raw(mid, q_tnt) * path_factor > target_p:
                lo = mid
            else:
                hi = mid
        return round((lo + hi) / 2.0)
    beta = channel_decay(area_m2, perimeter_m, lam)
    if beta <= 0:
        return round(r_tr)
    return round(r_tr + math.log(dp_tr / target_p) / beta)


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
    # Верхний предел 50 км — см. комментарий в TS-ядре
    lo, hi = 0.1, 50000.0
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


def empty_result(th, reason, log, warnings) -> dict:
    """Результат «взрыва не было»: нулевые параметры, пустой список зон.

    Возвращается при нулевом заряде и при смеси вне пределов взрываемости.
    Список zones намеренно ПУСТОЙ, а не с нулевыми радиусами: клиент рисует
    окружности по radius_m, и зона радиусом 0 всё равно дала бы точку на
    схеме и строку в легенде, будто поражение есть.
    """
    return {
        "q_tnt_kg":          0,
        "maxDeltaP_kPa":     0,
        "maxImpulse_Pas":    0,
        "waveFrontSpeed_ms": 0,
        "minValidRadius_m":  0,
        "thresholds":        th,
        "noExplosion":       True,
        "noExplosionReason": reason,
        "zones":             [],
        "pressurePoints":    [],
        "log":               log,
        "warnings":          warnings,
    }


def calc_one(body: dict) -> dict:
    """Расчёт одного взрыва по его исходным данным. Возвращает готовый результат."""
    method       = body.get("method", "gas_dynamics")
    source_type  = body.get("sourceType", "gas")
    area_m2      = float(body.get("excavationArea_m2", 12))
    perimeter_m  = body.get("excavationPerimeter_m")
    perimeter_m  = float(perimeter_m) if perimeter_m else None
    consider_walls = bool(body.get("considerWalls", True))
    distances    = body.get("distances", [])
    th           = normalize_thresholds(body.get("thresholds"))
    # Канальная модель включена по умолчанию (см. блок выше).
    channel_mode = body.get("channelMode") is not False
    lam          = body.get("channelLambda")
    lam          = float(lam) if lam else None
    # Длина загазованного участка (как в «Аэросети»). Объём смеси считается
    # как длина × сечение; поле gasVolume_m3 остаётся запасным вариантом.
    gas_zone_len = body.get("gasZoneLength_m")
    gas_zone_len = float(gas_zone_len) if gas_zone_len else 0.0
    # ΔP0: если не задано (или 0) — считается автоматически по длине участка
    gas_p0_manual = body.get("gasInitialPressure_kPa")
    gas_p0_manual = float(gas_p0_manual) if gas_p0_manual else 0.0

    log = []
    warnings = []
    # Причина отсутствия взрыва. Если заполнена — расчёт прекращается.
    no_explosion_reason = ""

    # 1. Тротиловый эквивалент
    q_tnt = 0.0
    volume = 0.0   # объём газовоздушной смеси, м³ (нужен и ниже, вне ветки)
    gas_ev = 0.0   # удельная энергия смеси, МДж/м³ — через неё вид газа,
                   # концентрация и Z влияют на ΔP0 (см. gas_initial_pressure)
    if source_type == "gas":
        gas_id  = body.get("gasId", "methane")
        gas     = GAS_TYPES.get(gas_id, GAS_TYPES["methane"])
        # ГЛАВНОЕ: объём = длина участка × сечение выработки. Раньше поле
        # «объём» трактовалось буквально (100 м³ при сечении 12 м² — это
        # всего 8 м выработки), отчего энергия занижалась в разы.
        volume  = (gas_zone_len * area_m2) if (gas_zone_len > 0 and area_m2 > 0) \
                  else float(body.get("gasVolume_m3", 100))
        conc    = float(body.get("gasConcentration", 9.5))
        u = conc_unit_label(gas.get("unit"))
        # ПРОВЕРКА ВЗРЫВАЕМОСТИ прекращает расчёт, а не просто предупреждает:
        # вне пределов НПВ/ВПВ смесь физически не детонирует, а раньше энергия
        # считалась как для взрывоопасной и зоны поражения всё равно строились.
        if conc <= 0:
            no_explosion_reason = "Концентрация горючего равна нулю — взрыв невозможен"
        elif conc < gas["lowerLimit"]:
            no_explosion_reason = (f"Концентрация {conc} {u} ниже НПВ ({gas['lowerLimit']} {u}) — "
                                   "смесь не взрывоопасна, зоны поражения не образуются")
        elif conc > gas["upperLimit"]:
            no_explosion_reason = (f"Концентрация {conc} {u} выше ВПВ ({gas['upperLimit']} {u}) — "
                                   "смесь не взрывоопасна, зоны поражения не образуются")
        elif volume <= 0:
            no_explosion_reason = "Объём взрывоопасной смеси равен нулю — взрыв невозможен"
        # Обогащённая смесь: горючего больше стехиометрии — не хватает
        # кислорода, энергия ограничена окислителем.
        eff_conc = min(conc, gas["stoichConc"])
        z = float(body.get("zParticipation") or Z_DEFAULT)
        if z <= 0:
            z = Z_DEFAULT
        q_tnt = gas_to_tnt(gas, volume, eff_conc, z)
        gas_ev = gas_energy_density(gas, conc, z)
        if gas_zone_len > 0:
            log.append(f"Загазованный участок: длина {gas_zone_len} м × сечение {area_m2} м² = {round(volume)} м³ смеси")
        log.append(f"{'Пыль' if gas.get('unit') == 'g/m3' else 'Газ'}: {gas_id}, объём: {round(volume)} м³, концентрация: {conc} {u}")
        if eff_conc < conc:
            log.append(f"Смесь обогащённая: в расчёт принята стехиометрическая концентрация {eff_conc} {u}")
        log.append(f"Коэффициент участия Z (Методика №415): {z}")
    else:
        expl_id = body.get("explosiveId", "ammonit")
        expl    = EXPLOSIVE_TYPES.get(expl_id, EXPLOSIVE_TYPES["ammonit"])
        mass_kg = float(body.get("explosiveMass_kg", 10))
        # Нулевая масса заряда — взрывать нечего.
        if mass_kg <= 0:
            no_explosion_reason = "Масса взрывчатого вещества равна нулю — взрыв невозможен"
        k_tnt   = tnt_equivalent(expl)
        q_tnt   = mass_kg * k_tnt
        log.append(f"ВВ: {expl_id}, масса: {mass_kg} кг, Q_уд = {expl['qSpec']} кДж/кг")
        log.append(f"Тротиловый эквивалент: k = {expl['qSpec']} / {Q_TNT:.0f} = {k_tnt}")

    # Раньше здесь подставлялось q_tnt = 0.001 кг «чтобы не делить на ноль»,
    # и из этой выдуманной сотой грамма вырастали настоящие зоны поражения
    # с ненулевыми радиусами. Теперь расчёт честно возвращает нули.
    if not no_explosion_reason and q_tnt <= 0:
        no_explosion_reason = "Тротиловый эквивалент равен нулю — взрыв невозможен"

    if no_explosion_reason:
        warnings.append(no_explosion_reason)
        log.append(f"Взрыв не происходит: {no_explosion_reason.lower()}")
        log.append("Зоны поражения не рассчитываются, радиусы приняты равными нулю")
        return empty_result(th, no_explosion_reason, log, warnings)

    q_tnt_rounded = round(q_tnt * 100) / 100
    log.append(f"Тротиловый эквивалент: Q_tnt = {q_tnt_rounded} кг ТНТ")

    # 2. Модель распространения.
    # При канальной модели wall_factor НЕ применяется: он был грубой заменой
    # канализирования постоянным множителем, и вместе с каналом эффект
    # учитывался бы дважды — та же ошибка, из-за которой убрали «ФНиП №494».
    wall_factor = wall_reflection_factor(area_m2) if (consider_walls and not channel_mode) else 1.0
    r_tr = max(transition_radius(area_m2), min_valid_radius(q_tnt)) if channel_mode else 0.0
    beta = channel_decay(area_m2, perimeter_m, lam) if channel_mode else 0.0

    # ГАЗ — протяжённый загазованный участок: волна плоская с самого начала,
    # сферическая ближняя зона по Садовскому не применяется.
    gas_mode = channel_mode and source_type == "gas"
    gas_len = gas_zone_len if gas_zone_len > 0 else (volume / area_m2 if area_m2 > 0 else 0.0)
    # ΔP0 — вручную либо автоматически по длине участка (как в «Аэросети»)
    gas_p0 = gas_p0_manual if gas_p0_manual > 0 else gas_initial_pressure(gas_len, gas_ev)

    def dp_at(r):
        if gas_mode:
            return gas_pressure_at(r, gas_len, gas_p0, area_m2, perimeter_m, lam)
        if channel_mode:
            return channel_pressure_at(r, q_tnt, area_m2, perimeter_m, lam)
        return pressure_at(r, q_tnt, method, wall_factor)

    def imp_at(r):
        if gas_mode:
            return gas_impulse_at(r, gas_len, gas_p0, area_m2, perimeter_m, lam)
        if channel_mode:
            return channel_impulse_at(r, q_tnt, area_m2, perimeter_m, lam)
        return round(sadovsky_impulse(r, q_tnt) * wall_factor, 1)

    def reach_at(p):
        if gas_mode:
            return gas_distance_at_pressure(p, gas_len, gas_p0, area_m2, perimeter_m, lam)
        if channel_mode:
            return channel_distance_at_pressure(p, q_tnt, area_m2, perimeter_m, lam)
        return radius_at_pressure(p, q_tnt, method, wall_factor)

    if gas_mode:
        log.append("Модель источника: протяжённый загазованный участок (плоская волна, как в «Аэросети»)")
        log.append(f"Длина участка: {round(gas_len, 1)} м")
        if gas_p0_manual > 0:
            log.append(f"Начальное давление ΔP₀ = {gas_p0} кПа (задано вручную)")
        else:
            log.append(f"Удельная энергия смеси: {round(gas_ev, 3)} МДж/м³ "
                       f"(эталон метан 9,5 % при Z=0,5: {GAS_EV_REF}; отношение {round(gas_ev / GAS_EV_REF, 3)})")
            log.append(f"Начальное давление ΔP₀ = {gas_p0} кПа ({GAS_P0_COEF}·L^{GAS_P0_EXP}·E_v/E_ref)")

    if channel_mode:
        d_g = hydraulic_diameter(area_m2, perimeter_m)
        log.append("Модель распространения: канальная (плоская волна по выработке)" if gas_mode
                   else "Модель распространения: канальная (ближняя зона — Садовский, дальняя — выработка)")
        log.append(f"Сечение S = {area_m2} м², гидравлический диаметр d = {round(d_g, 2)} м")
        log.append(f"Коэффициент сопротивления λ = {lam if lam else LAMBDA_DEFAULT}")
        # Переход сфера → канал есть только у компактного заряда (ВВ).
        if not gas_mode:
            log.append(f"Переход сфера → канал: r = {round(r_tr, 1)} м")
        log.append(f"Погонное затухание β = λ/(2d) = {beta:.3e} 1/м")
    elif consider_walls:
        log.append(f"Модель распространения: сферическая, коэффициент стенок k = {wall_factor}")

    # 3. Максимум. Для газа это ΔP₀ в самом участке; для ВВ — на границе
    # применимости формулы (r̄ = 1), а не при r = 1 м.
    r_min    = 0.0 if gas_mode else min_valid_radius(q_tnt)
    max_dp   = dp_at(r_min)
    max_imp  = imp_at(r_min)
    # Длительность фазы сжатия — без неё импульсы газа и ВВ несопоставимы
    phase_ms = round((gas_phase_duration(gas_len) if gas_mode
                      else tnt_phase_duration(r_min, q_tnt)) * 1000, 1)
    wave_spd = wave_front_speed(max_dp)

    if gas_mode:
        log.append("Методика: плоская волна от загазованного участка, Q_тнт по Методике №415 (справочно)")
        log.append(f"Максимальное давление (внутри участка): ΔP = {max_dp} кПа")
        log.append(f"Длительность фазы сжатия: τ = (L/2)/c_прод = {phase_ms} мс (c_прод = {C_PRODUCTS} м/с)")
    else:
        log.append("Методика: газодинамическая (Садовский), Q_тнт по Методике №415")
        log.append(f"Граница применимости формулы: r̄ = 1, то есть r = {r_min} м")
        log.append(f"Максимальное давление во фронте (r = {r_min} м): ΔP = {max_dp} кПа")
        log.append(f"Длительность фазы сжатия: τ = i/ΔP = {phase_ms} мс")
    log.append(f"Импульс: i = ΔP·τ = {max_imp} Па·с")
    log.append(f"Скорость фронта: D = {wave_spd} м/с")

    # 4. Зоны поражения
    # Зоны строятся из порогов справочника, а не из зашитых чисел.
    zone_defs = [
        ("Летальная",         "lethal", th["lethal"], None,         "летальный исход, полное разрушение"),
        ("Тяжёлые поражения", "heavy",  th["heavy"],  th["lethal"], "тяжёлые травмы, обрушение"),
        ("Средние поражения", "medium", th["medium"], th["heavy"],  "средние травмы, повреждение"),
        ("Лёгкие поражения",  "light",  th["light"],  th["medium"], "контузии, лёгкие повреждения"),
    ]
    # В канальном режиме radius_m — это ДЛИНА ПУТИ ПО ВЫРАБОТКЕ, а не радиус
    # сферы. Поэтому значения получаются в сотни метров: волна не рассеивается
    # в объём, а идёт по каналу.
    zones = []
    for name, hlevel, lo, hi, what in zone_defs:
        r = reach_at(lo)
        imp = imp_at(r) if r > 0 else 0
        rng = f"> {lo}" if hi is None else f"{lo}–{hi}"
        zones.append({"name": name, "description": f"ΔP {rng} кПа — {what}",
                      "radius_m": r, "deltaP_kPa": lo, "impulse_Pas": imp,
                      "hazardLevel": hlevel})
        log.append(f"{name}: r = {r} м, ΔP = {lo} кПа")
    r_safe = reach_at(th["safe"])
    zones.append({"name": "Безопасная зона",
                  "description": f"ΔP < {th['safe']} кПа — незначительное воздействие",
                  "radius_m": r_safe, "deltaP_kPa": th["safe"],
                  "impulse_Pas": imp_at(r_safe) if r_safe > 0 else 0,
                  "hazardLevel": "safe"})
    log.append(f"Безопасная зона: r = {r_safe} м, ΔP = {th['safe']} кПа")

    # 5. Давление в произвольных точках (опционально)
    pressure_points = []
    for r in distances:
        dp = dp_at(float(r))
        imp = imp_at(float(r))
        pressure_points.append({"r_m": r, "deltaP_kPa": dp, "impulse_Pas": imp,
                                 "hazardLevel": hazard_level(dp, th)})

    result = {
        "q_tnt_kg":           q_tnt_rounded,
        "maxDeltaP_kPa":      max_dp,
        "maxImpulse_Pas":     max_imp,
        "phaseDuration_ms":   phase_ms,
        "waveFrontSpeed_ms":  wave_spd,
        "minValidRadius_m":   r_min,
        "thresholds":         th,
        "channelMode":        channel_mode,
        "transitionRadius_m": round(r_tr, 1) if channel_mode else None,
        "channelDecay_per_m": beta if channel_mode else None,
        # Параметры канала нужны клиенту, чтобы вести волну по графу
        "channel":            ({"area_m2": area_m2, "perimeter_m": perimeter_m,
                                "lambda": lam if lam else LAMBDA_DEFAULT}
                               if channel_mode else None),
        # Параметры газового источника — клиент ведёт по ним волну по графу
        "gasSource":          ({"zoneLength_m": round(gas_len, 2),
                                "initialPressure_kPa": gas_p0}
                               if gas_mode else None),
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

    # Расчёт — только по действительной лицензии (см. license_guard).
    denied = license_gate(body, CORS, "explosion")
    if denied:
        return denied

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