"""
Гидравлический расчёт водопроводной сети ППЗ.

Метод: глобальный градиентный (Ньютон по напорам узлов и расходам труб) —
корректно считает развилки, кольца, несколько резервуаров. λ — по режиму
течения (ламинарный / переходный / Альтшуль). Подробности — в solver.py.

POST: {
  nodes: [{id, fireNodeType, fireInitPressure, fireCapacity,
           fireHydrantOpen, fireHydrantDiameter, fireResistanceMode,
           fireManualR, z}],
  branches: [{id, fromId, toId,
              hasWaterPipe, wpDiameter, wpLengthManual, wpLength, length,
              wpRoughnessMode, wpRoughness, wpManualR, wpLocalXi,
              wpHasReducer, wpReducerOutPressure, wpReducerMaxFlow, z,
              wpHasPump, wpPumpHead, wpPumpReverse}]
}

Диаметр трубы wpDiameter — наружный, wpWallThickness — толщина стенки (мм).
wpRoughnessMode "material" (по умолчанию) — сталь/чугун по λ = 0,021/d^0,3,
остальные материалы — по эквивалентной шероховатости wpMaterial.

"""
import json
from license_guard import license_gate

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
}


from solver import calc_water_network


def handler(event: dict, context) -> dict:
    """Гидравлический расчёт сети противопожарного водоснабжения (ППЗ)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body       = json.loads(event.get("body") or "{}")

    # Расчёт — только по действительной лицензии (см. license_guard).
    denied = license_gate(body, CORS, "water")
    if denied:
        return denied

    nodes_in   = body.get("nodes", [])
    branches_in = body.get("branches", [])

    result = calc_water_network(nodes_in, branches_in)

    # Конвертируем dict-ключи в списки для JSON (Map → array)
    out = {
        "nodeResults":   list(result["nodeResults"].values()),
        "branchResults": list(result["branchResults"].values()),
    }
    # Content-Type обязателен: без него ответ читается как обычный текст, а не
    # как данные — проверки функции падали на всех тестах, хотя сами цифры были
    # верные. В расчёте воздухораспределения этот заголовок стоит, здесь забыли.
    return {
        "statusCode": 200,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(out, ensure_ascii=False),
    }