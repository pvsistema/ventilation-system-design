"""
Сетевой гидравлический расчёт водопровода ППЗ — глобальный градиентный метод
(Todini–Pilati, как в EPANET): Ньютон по расходам в трубах и напорам в узлах.

Неизвестные: пьезометрический напор H узла (МПа, H = P + ρ·g·z) и расход q
в каждой связи (м³/с, знак — относительно направления from→to).
  • Резервуар — узел с ЗАДАННЫМ напором H = P₀ + ρ·g·z.
  • Открытый кран — «связь» от узла в атмосферу (H_атм = ρ·g·z узла) с
    сопротивлением насадка: истечение Q = μA·√(2P/ρ), обратного тока нет.
  • Труба — потери Дарси–Вейсбаха, λ по режиму течения:
      Re < 2000  — ламинарный, λ = 64/Re;
      Re > 4000  — турбулентный, λ = 0.11·(Δ/d + 68/Re)^0.25 (Альтшуль);
      между ними — линейная интерполяция (переходная зона).
  • Насос — постоянный прирост напора в направлении качания, с обратным клапаном.
  • Редукционный клапан — дросселирует так, чтобы давление за ним не
    превышало уставку; обратного тока не пропускает.
В каждом узле выполняется баланс расходов (1-й закон Кирхгофа), в каждом
контуре — баланс потерь (2-й закон): кольца и развилки считаются честно.
"""
import math, heapq, collections

RHO = 1000.0
G = 9.81
NU = 1.31e-6               # м²/с — кинематическая вязкость воды при ~10 °C (шахтная вода)
RHO_G_MPA = RHO * G / 1e6  # МПа на метр высоты
NOZZLE_MU = 0.92          # конический насадок пожарного ствола (по паспортам РС-50/РС-70)
SMOOTH_ROUGHNESS_MM = 0.03
RE_LAM = 2000.0
RE_TURB = 4000.0
MIN_PIPE_LEN = 1.0          # м — у трубы нулевой длины всё равно есть сопротивление
Q_REG = 1e-4                # м³/с — сглаживание квадратичного закона у нуля
C_CLOSED = 1e-8             # проводимость закрытой связи (обратный клапан)
MAX_ITER = 120
SOURCE_R = 1e-3            # МН·с²/м⁸ — пренебрежимо малое сопротивление выхода резервуара

# Сталь и чугун (трубы в эксплуатации) считаются по λ = 0,021/d^0,3 (как в «Аэросети»).
SHEVELEV_MATERIALS = {"Сталь", "Чугун"}


def shevelev_lambda(d_m):
    """λ = 0.021 / d^0.3 — стальные и чугунные трубы в эксплуатации, квадратичная зона."""
    return 0.021 / d_m ** 0.3


def pipe_roughness_mode(b):
    """Способ расчёта сопротивления; старый режим "shevelev" = «по материалу»."""
    m = b.get("wpRoughnessMode") or "material"
    return "material" if m == "shevelev" else m


def uses_shevelev(b):
    return pipe_roughness_mode(b) == "material" and (b.get("wpMaterial") or "Сталь") in SHEVELEV_MATERIALS


# Эквивалентная шероховатость Δ, мм — для труб, бывших в эксплуатации.
MATERIAL_ROUGHNESS_MM = {
    "Сталь": 0.5,
    "Чугун": 1.0,
    "Полиэтилен": 0.02,
    "ПВХ": 0.02,
    "Асбестоцемент": 0.6,
    "Прочее": 0.5,
}


def _f(x, default=0.0):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def node_z(n):
    if n is None:
        return 0.0
    sz = n.get("surveyZ")
    return _f(sz if sz is not None else n.get("z"), 0.0)


def pipe_inner_diameter_mm(b):
    """Внутренний диаметр: наружный − 2 × толщина стенки."""
    d = (_f(b.get("wpDiameter"), 100.0) or 100.0) - 2.0 * max(0.0, _f(b.get("wpWallThickness"), 0.0))
    return d if d > 1.0 else 1.0


def pipe_roughness_mm(b):
    mode = pipe_roughness_mode(b)
    if mode == "smooth":
        return SMOOTH_ROUGHNESS_MM
    if mode == "material":
        return MATERIAL_ROUGHNESS_MM.get(b.get("wpMaterial") or "Сталь", 0.5)
    return max(0.0, _f(b.get("wpRoughness"), 0.5))


def pipe_length_m(b):
    ln = b.get("wpLength") if b.get("wpLengthManual") else b.get("length")
    return max(0.0, _f(ln, 0.0))


def nozzle_resistance(diam_mm, mu=NOZZLE_MU):
    """Сопротивление насадка (МН·с²/м⁸): P = R·Q²."""
    if diam_mm <= 0:
        return 0.0
    d = diam_mm / 1000.0
    a = math.pi * d * d / 4.0
    return RHO / (2.0 * (mu * a) ** 2) / 1e6


def consumer_resistance(n):
    if (n.get("fireResistanceMode") or "project") == "project":
        return nozzle_resistance(_f(n.get("fireHydrantDiameter"), 0.0))
    return max(0.0, _f(n.get("fireManualR"), 0.0))


# ─── Модель трубы ──────────────────────────────────────────────────────────────

class Pipe:
    __slots__ = ("d", "A", "L", "e", "xi", "K", "C1", "manualR", "lamA", "lamB", "xiInR")

    def __init__(self, b):
        self.manualR = None
        self.xiInR = False   # входят ли местные сопротивления в manualR («Своё R» — нет)
        if pipe_roughness_mode(b) == "manual":
            self.manualR = max(0.0, _f(b.get("wpManualR"), 0.0))
        self.d = pipe_inner_diameter_mm(b) / 1000.0
        self.A = math.pi * self.d * self.d / 4.0
        self.L = max(MIN_PIPE_LEN, pipe_length_m(b))
        self.e = pipe_roughness_mm(b) / 1000.0 / self.d
        self.xi = max(0.0, _f(b.get("wpLocalXi"), 0.0))
        self.K = RHO / (2.0 * self.A * self.A) / 1e6      # МПа·с²/м⁶
        # Сталь/чугун: постоянное сопротивление R = (λ·L/d + Σξ)·ρ/(2S²)
        if self.manualR is None and uses_shevelev(b):
            self.manualR = self.K * (shevelev_lambda(self.d) * self.L / self.d + self.xi)
            self.xiInR = True
        self.C1 = self.d / (self.A * NU)                  # Re = C1·|q|
        lam_l = 64.0 / RE_LAM
        lam_t = 0.11 * (self.e + 68.0 / RE_TURB) ** 0.25
        self.lamB = (lam_t - lam_l) / (RE_TURB - RE_LAM)
        self.lamA = lam_l - self.lamB * RE_LAM

    def lam(self, aq):
        re = self.C1 * aq
        if self.manualR is not None:
            xi = self.xi if self.xiInR else 0.0
            lam = (self.manualR / self.K - xi) * self.d / self.L
            return max(0.0, lam), re
        if re <= RE_LAM:
            return 64.0 / re if re > 0 else float("inf"), re
        if re < RE_TURB:
            return self.lamA + self.lamB * re, re
        return 0.11 * (self.e + 68.0 / re) ** 0.25, re

    def loss(self, q):
        """Потери давления (МПа, со знаком q) и производная по q."""
        aq = abs(q)
        sgn = 1.0 if q >= 0 else -1.0
        if self.manualR is not None:
            r = self.manualR
            s = math.sqrt(q * q + Q_REG * Q_REG)
            return r * q * s, r * (s + q * q / s)
        K, Ld = self.K, self.L / self.d
        re = self.C1 * aq
        if re <= RE_LAM:
            lin = K * 64.0 * Ld / self.C1          # λ·q|q| = 64q/C1
            h = lin * q + K * self.xi * q * aq
            dh = lin + 2.0 * K * self.xi * aq
            return h, dh
        if re < RE_TURB:
            lam = self.lamA + self.lamB * re
            dlam = self.lamB * self.C1
        else:
            t = self.e + 68.0 / re
            lam = 0.11 * t ** 0.25
            dlam = 0.11 * 0.25 * t ** -0.75 * (-68.0 / (re * re)) * self.C1
        h = K * (lam * Ld + self.xi) * q * aq
        dh = K * (dlam * Ld * aq * aq + 2.0 * (lam * Ld + self.xi) * aq)
        return h, dh

    def equiv_r(self, q):
        """Эквивалентное сопротивление R = ΔP/Q² (МН·с²/м⁸) при расходе q."""
        if self.manualR is not None:
            return self.manualR
        aq = abs(q)
        if aq < 1e-6:
            lam = 0.11 * self.e ** 0.25 if self.e > 0 else 0.0
            return self.K * (lam * self.L / self.d + self.xi)
        h, _ = self.loss(aq)
        return h / (aq * aq)


# ─── Разреженный решатель SPD-системы (LDLᵀ с упорядочением мин. степени) ─────

def min_degree_order(n, adj_sets):
    adj = [set(s) for s in adj_sets]
    alive = [True] * n
    heap = [(len(adj[i]), i) for i in range(n)]
    heapq.heapify(heap)
    order = []
    while heap:
        deg, k = heapq.heappop(heap)
        if not alive[k] or deg != len(adj[k]):
            continue
        alive[k] = False
        order.append(k)
        nb = adj[k]
        for i in nb:
            ai = adj[i]
            ai.discard(k)
            ai |= nb
            ai.discard(i)
            heapq.heappush(heap, (len(ai), i))
        adj[k] = set()
    return order


def ldl_solve(n, diag, off, rhs, order):
    rows = [dict(r) for r in off]
    d = list(diag)
    b = list(rhs)
    saved = []
    for k in order:
        dk = d[k]
        items = list(rows[k].items())
        bk = b[k]
        for i, aik in items:
            f = aik / dk
            d[i] -= f * aik
            b[i] -= f * bk
            ri = rows[i]
            del ri[k]
            for j, ajk in items:
                if j != i:
                    ri[j] = ri.get(j, 0.0) - f * ajk
        saved.append((k, dk, items))
    x = [0.0] * n
    for k, dk, items in reversed(saved):
        s = b[k]
        for i, aik in items:
            s -= aik * x[i]
        x[k] = s / dk
    return x


# ─── Основной расчёт ──────────────────────────────────────────────────────────

def _zero_branch(bid):
    return {
        "branchId": bid, "flow": 0.0, "velocity": 0.0, "deltaP": 0.0, "resistance": 0.0,
        "reducerActive": False, "reducerInP": 0.0, "reducerOutP": 0.0, "reducerDeltaP": 0.0,
        "pumpActive": False, "pumpHeadM": 0.0, "pumpDeltaP": 0.0,
    }


def calc_water_network(nodes_in, branches_in):
    node_results, branch_results = {}, {}
    node_map = {n["id"]: n for n in nodes_in}

    def closed(b):
        return bool(b.get("wpHasGate")) and bool(b.get("wpGateClosed"))

    for b in branches_in:
        if b.get("hasWaterPipe") and closed(b):
            branch_results[b["id"]] = _zero_branch(b["id"])

    pipes = [b for b in branches_in
             if b.get("hasWaterPipe") and not closed(b) and b.get("fromId") != b.get("toId")]

    reservoirs = [n for n in nodes_in if (n.get("fireNodeType") or "none") == "reservoir"]
    consumers = [n for n in nodes_in if (n.get("fireNodeType") or "none") == "consumer"
                 and n.get("fireHydrantOpen") and consumer_resistance(n) > 0]

    # Связные компоненты: считаем только сети, где есть резервуар.
    adj = collections.defaultdict(set)
    for b in pipes:
        adj[b["fromId"]].add(b["toId"])
        adj[b["toId"]].add(b["fromId"])
    for n in reservoirs + consumers:
        adj[n["id"]]
    comp = {}
    for s in list(adj.keys()):
        if s in comp:
            continue
        comp[s] = s
        st = [s]
        while st:
            c = st.pop()
            for nb in adj[c]:
                if nb not in comp:
                    comp[nb] = s
                    st.append(nb)
    live_comps = {comp[r["id"]] for r in reservoirs}
    live = {nid for nid, c in comp.items() if c in live_comps}

    # Резервуар — фиктивный узел с заданным напором, соединённый с реальным
    # узлом связью-«источником» с обратным клапаном: вода из резервуара только
    # ОТБИРАЕТСЯ. Иначе два резервуара с разным давлением в одной сети
    # «перекачивали» бы воду друг в друга, искажая расходы и время работы.
    fixed_h = {}
    for r in reservoirs:
        fixed_h["__src__" + r["id"]] = _f(r.get("fireInitPressure"), 0.0) + RHO_G_MPA * node_z(r)

    free_ids = [nid for nid in adj.keys() if nid in live]
    idx = {nid: i for i, nid in enumerate(free_ids)}
    nfree = len(free_ids)

    # ── Связи ───────────────────────────────────────────────────────────────
    # kind: pipe | emitter. d — направление обратного клапана (+1/-1) или 0.
    links = []
    for b in pipes:
        if b["fromId"] not in live:
            continue
        pump_head = _f(b.get("wpPumpHead"), 0.0) if b.get("wpHasPump") else 0.0
        has_red = bool(b.get("wpHasReducer"))
        d = 0
        if pump_head > 0:
            d = -1 if b.get("wpPumpReverse") else 1
        p = Pipe(b)
        links.append({
            "b": b, "kind": "pipe", "i": b["fromId"], "j": b["toId"], "pipe": p,
            "d": d, "pump": pump_head * RHO_G_MPA if pump_head > 0 else 0.0,
            "pumpHeadM": pump_head, "red": has_red,
            "redTarget": _f(b.get("wpReducerOutPressure"), 0.5) if has_red else 0.0,
            "dv": 0.0, "q": (d or 1) * p.A * 0.5, "open": True,
        })
    for r in reservoirs:
        links.append({
            "kind": "source", "i": "__src__" + r["id"], "j": r["id"], "R": SOURCE_R,
            "d": 1, "pump": 0.0, "red": False, "dv": 0.0, "q": 1e-3, "open": True,
        })
    for c in consumers:
        if c["id"] not in live:
            continue
        links.append({
            "kind": "emitter", "i": c["id"], "j": None, "R": consumer_resistance(c),
            "hAtm": RHO_G_MPA * node_z(c), "d": 1, "pump": 0.0, "red": False,
            "dv": 0.0, "q": 1e-3, "open": True,
        })

    def head_of(nid, H):
        if nid in fixed_h:
            return fixed_h[nid]
        k = idx.get(nid)
        return H[k] if k is not None else 0.0

    def link_f(L, q):
        """Уравнение связи: H_i − H_j = f(q). Возвращает f и f'."""
        if L["kind"] != "pipe":
            r = L["R"]
            s = math.sqrt(q * q + Q_REG * Q_REG)
            return r * q * s, r * (s + q * q / s)
        h, dh = L["pipe"].loss(q)
        if L["pump"]:
            h -= L["d"] * L["pump"]
        if L["red"] and L["d"]:
            h += L["d"] * L["dv"]
        return h, dh

    def link_f0(L):
        f0 = 0.0
        if L["kind"] == "pipe":
            if L["pump"]:
                f0 -= L["d"] * L["pump"]
            if L["red"] and L["d"]:
                f0 += L["d"] * L["dv"]
        return f0

    # Структура матрицы и упорядочение — один раз.
    struct = [set() for _ in range(nfree)]
    for L in links:
        a = idx.get(L["i"])
        bb = idx.get(L["j"]) if L["j"] is not None else None
        if a is not None and bb is not None and a != bb:
            struct[a].add(bb)
            struct[bb].add(a)
    order = min_degree_order(nfree, struct)

    H = [0.0] * nfree
    if fixed_h:
        h0 = max(fixed_h.values())
        H = [h0] * nfree

    def solve_once():
        nonlocal H
        damping = 1.0
        prev_err = float("inf")
        for it in range(MAX_ITER):
            diag = [0.0] * nfree
            off = [dict() for _ in range(nfree)]
            rhs = [0.0] * nfree
            cb = []
            for L in links:
                if L["open"]:
                    f, df = link_f(L, L["q"])
                    c = 1.0 / max(df, 1e-12)
                    bval = L["q"] - c * f
                else:
                    # Закрытый кран почти не связывает узел с атмосферой, а
                    # закрытый выход резервуара — сильнее: в сети без расхода
                    # давление должно определяться резервуаром (гидростатика).
                    c = C_CLOSED * (1e-4 if L["kind"] == "emitter" else 1.0)
                    bval = -c * link_f0(L)
                cb.append((c, bval))
                a = idx.get(L["i"])
                j = L["j"]
                bj = idx.get(j) if j is not None else None
                if a is not None:
                    diag[a] += c
                    rhs[a] -= bval
                    if bj is not None:
                        if bj != a:
                            off[a][bj] = off[a].get(bj, 0.0) - c
                    else:
                        rhs[a] += c * (L["hAtm"] if j is None else fixed_h.get(j, 0.0))
                if bj is not None:
                    diag[bj] += c
                    rhs[bj] += bval
                    if a is None:
                        rhs[bj] += c * fixed_h.get(L["i"], 0.0)
                    elif a != bj:
                        off[bj][a] = off[bj].get(a, 0.0) - c
            if nfree:
                H = ldl_solve(nfree, diag, off, rhs, order)
            err = 0.0
            changed = False
            for L, (c, bval) in zip(links, cb):
                hi = head_of(L["i"], H)
                hj = L["hAtm"] if L["j"] is None else head_of(L["j"], H)
                q_new = bval + c * (hi - hj)
                d = L["d"]
                if L["open"]:
                    q_new = L["q"] + damping * (q_new - L["q"])
                    if d and q_new * d < 0:
                        L["open"] = False
                        changed = True
                        q_new = 0.0
                else:
                    if d and d * ((hi - hj) - link_f0(L)) > 1e-9:
                        L["open"] = True
                        changed = True
                        q_new = d * 1e-4
                    else:
                        q_new = 0.0
                err = max(err, abs(q_new - L["q"]) / (abs(q_new) + 1e-3))
                L["q"] = q_new
            # Редукционные клапаны: срезать давление до уставки.
            for L in links:
                if not (L["red"] and L["d"]):
                    continue
                up = L["i"] if L["d"] > 0 else L["j"]
                p_up = head_of(up, H) - RHO_G_MPA * node_z(node_map.get(up))
                target = max(0.0, p_up - L["redTarget"])
                if abs(target - L["dv"]) > 1e-6:
                    changed = True
                L["dv"] += 0.8 * (target - L["dv"])
            if err > prev_err * 1.5 and it > 5:
                damping = max(0.3, damping * 0.7)
            prev_err = err
            if err < 1e-6 and not changed:
                return it + 1
        return MAX_ITER

    # Направление редукторов: сначала решаем сеть, считая их обычными трубами.
    reducers = [L for L in links if L["red"] and not L["d"]]
    iters = 0
    if reducers:
        saved = [(L, L["red"]) for L in reducers]
        for L in reducers:
            L["red"] = False
        iters += solve_once()
        for L, r in saved:
            L["red"] = r
            hi = head_of(L["i"], H)
            hj = head_of(L["j"], H) if L["j"] is not None else 0.0
            L["d"] = 1 if (L["q"] > 1e-9 or (abs(L["q"]) <= 1e-9 and hi >= hj)) else -1
            if L["q"] * L["d"] < 0:
                L["q"] = 0.0
    iters += solve_once()

    # ── Результаты ветвей ───────────────────────────────────────────────────
    out_flow = collections.defaultdict(float)  # м³/с — отбор из резервуара
    for L in links:
        q = L["q"]
        if L["kind"] == "source":
            out_flow[L["j"]] += max(0.0, q)
            continue
        if L["kind"] == "emitter":
            continue
        b = L["b"]
        bid = b["id"]
        p = L["pipe"]
        aq = abs(q) if abs(q) * 3600.0 >= 5e-4 else 0.0
        qh = aq * 3600.0
        h_loss = abs(p.loss(q)[0])
        lam, re = p.lam(aq) if aq > 0 else (0.0, 0.0)
        regime = "laminar" if re <= RE_LAM else ("transition" if re < RE_TURB else "turbulent")
        from_to = q >= 0
        if aq == 0:
            h_loss = 0.0
        up = b["fromId"] if from_to else b["toId"]
        p_up = head_of(up, H) - RHO_G_MPA * node_z(node_map.get(up))
        dv = L["dv"] if L["red"] and L["d"] else 0.0
        pump_on = L["pump"] > 0 and L["open"] and aq > 1e-9
        max_flow = _f(b.get("wpReducerMaxFlow"), 0.0)
        branch_results[bid] = {
            "branchId": bid,
            "flow": round(qh, 3),
            "velocity": round(aq / p.A, 3),
            "deltaP": round(h_loss, 5),
            "resistance": round(p.equiv_r(q), 6),
            "reducerActive": bool(L["red"] and dv > 1e-6),
            "reducerInP": round(max(0.0, p_up), 4),
            "reducerOutP": round(max(0.0, p_up - dv), 4),
            "reducerDeltaP": round(dv, 4),
            "reducerOverCapacity": bool(L["red"] and max_flow > 0 and qh > max_flow),
            "pumpActive": bool(pump_on),
            "pumpHeadM": round(L["pumpHeadM"], 2) if L["pump"] else 0.0,
            "pumpDeltaP": round(L["pump"], 4) if pump_on else 0.0,
            "flowFromTo": from_to,
            "innerDiameter": round(p.d * 1000.0, 1),
            "reynolds": round(re),
            "lambda": round(lam, 5) if math.isfinite(lam) else 0.0,
            "regime": regime if aq > 0 else "none",
        }

    emit_q = {L["i"]: L["q"] for L in links if L["kind"] == "emitter"}

    # Трубы вне сети с резервуаром — воды нет.
    for b in pipes:
        if b["id"] not in branch_results:
            branch_results[b["id"]] = _zero_branch(b["id"])

    # ── Результаты узлов ────────────────────────────────────────────────────
    for n in nodes_in:
        ft = n.get("fireNodeType") or "none"
        if ft == "none":
            continue
        nid = n["id"]
        if ft == "reservoir":
            q = max(0.0, out_flow.get(nid, 0.0)) * 3600.0
            if q < 5e-4:
                q = 0.0
            node_results[nid] = {
                "nodeId": nid, "staticP": round(_f(n.get("fireInitPressure"), 0.0), 4),
                "dynamicP": 0.0, "flow": round(q, 3), "resistance": 0.0,
                "drainTime": round((_f(n.get("fireCapacity"), 0.0) / q) * 60.0, 1) if q > 0 else 0.0,
            }
            continue
        in_net = nid in live and (nid in idx)
        p = head_of(nid, H) - RHO_G_MPA * node_z(n) if in_net else 0.0
        no_water = in_net and p < 0
        p = max(0.0, p)
        res = {
            "nodeId": nid, "staticP": round(p, 4), "dynamicP": 0.0, "flow": 0.0,
            "resistance": 0.0, "drainTime": 0.0, "noWater": bool(no_water or not in_net),
        }
        if ft == "consumer" and nid in emit_q:
            q = max(0.0, emit_q[nid])
            if q * 3600.0 < 5e-4:
                q = 0.0
            # Перед насадком всё давление узла срабатывается на истечение:
            # «динамическое» давление крана = давлению в узле при работе.
            res.update({
                "dynamicP": round(p if q > 0 else 0.0, 4),
                "flow": round(q * 3600.0, 3),
                "resistance": round(consumer_resistance(n), 6),
            })
        node_results[nid] = res

    return {"nodeResults": node_results, "branchResults": branch_results, "iterations": iters}
