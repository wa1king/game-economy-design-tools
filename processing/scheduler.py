"""Single-yield production-chain metrics and certified zero-stock scheduling.

This module has no third-party dependencies.  It does NOT call a heuristic
schedule optimal unless a valid lower bound reaches the feasible makespan or
the complete disjunctive search has been exhausted.

Input products: {id, name, building, level, time, yield: 1,
                 inputs: [[ingredient_id, positive_integer_quantity], ...]}.
Every product without ingredients is a crop.  Crop tasks share ``lands``
identical plots.  Each processing building is one non-preemptive channel.
All facilities are available at t=0, inventory is empty, actions are instant,
and each individual production yields exactly one unit.  Prices, player login
intervals, construction time and stock policies are outside this calculation.

Public API: analyze(products, lands_by_level, time_limit_seconds=2.0).
The result contains a ``products`` list, keyed by ``id`` in each entry.
CLI: python crop_chain_schedule_analysis.py input.json --output output.json
where the JSON object contains products and lands_by_level.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import time as clock
from collections import Counter, defaultdict, deque
from fractions import Fraction
from itertools import combinations
from pathlib import Path


def _number(value):
    value = Fraction(value)
    return int(value) if value.denominator == 1 else round(float(value), 6)


def _normalise(products):
    result = {}
    for original in products:
        item = dict(original)
        key = str(item["id"])
        if key in result:
            raise ValueError(f"Duplicate product id: {key}")
        if item.get("yield", 1) != 1:
            raise ValueError(f"{item.get('name', key)} must yield exactly 1")
        duration = Fraction(str(item["time"]))
        if duration <= 0:
            raise ValueError(f"Non-positive production time: {key}")
        inputs = []
        for ingredient, amount in item.get("inputs", []):
            if isinstance(amount, bool) or int(amount) != amount or amount <= 0:
                raise ValueError(f"Ingredient quantities must be positive integers: {key}")
            inputs.append((str(ingredient), int(amount)))
        item.update(key=key, duration=duration, inputs=inputs,
                    level=int(item.get("level", 1)), yield_per_task=1)
        result[key] = item
    for item in result.values():
        for key, _ in item["inputs"]:
            if key not in result:
                raise ValueError(f"Unknown ingredient {key} in {item['key']}")
            if result[key]["level"] > item["level"]:
                raise ValueError(f"Ingredient {key} unlocks after {item['key']}")
    visiting, done = set(), set()

    def visit(key):
        if key in visiting:
            raise ValueError(f"Recipe cycle involving {key}")
        if key in done:
            return
        visiting.add(key)
        for ingredient, _ in result[key]["inputs"]:
            visit(ingredient)
        visiting.remove(key)
        done.add(key)

    for key in result:
        visit(key)
    return result


def _land_schedule(lands_by_level):
    entries = lands_by_level.items() if isinstance(lands_by_level, dict) else lands_by_level
    if isinstance(lands_by_level, list) and entries and isinstance(lands_by_level[0], dict):
        entries = [(x["level"], x.get("lands", x.get("land_count"))) for x in lands_by_level]
    values = sorted((int(level), int(lands)) for level, lands in entries)
    if not values or any(lands < 1 for _, lands in values):
        raise ValueError("At least one positive land-capacity entry is required")
    if any(b[1] < a[1] for a, b in zip(values, values[1:])):
        raise ValueError("Land capacity cannot decrease with level")
    return values


def _lands_at(level, values):
    eligible = [lands for unlock, lands in values if unlock <= level]
    if not eligible:
        raise ValueError(f"No plots available at level {level}")
    return eligible[-1]


def _expand(target, products):
    denominator = math.lcm(*(x["duration"].denominator for x in products.values()))
    tasks, edges = [], set()

    def add(key):
        product = products[key]
        task_id = len(tasks)
        tasks.append({"task_id": task_id, "product_id": product["id"],
                      "product_key": key, "name": product.get("name", key),
                      "resource": "__land__" if not product["inputs"] else str(product["building"]),
                      "duration": int(product["duration"] * denominator)})
        for ingredient, amount in product["inputs"]:
            for _ in range(amount):
                child = add(ingredient)
                edges.add((child, task_id))
        return task_id

    root = add(target)
    return tasks, frozenset(edges), root, denominator


def _dag_bounds(tasks, edges, capacities):
    """Return integer lower bound, precedence ASAP schedule, and tails.

    Energetic bound: tasks whose release >= r and remaining tail >= q must
    all fit in [r, makespan-q].  Their work/capacity is a lower bound on that
    interval.  Release and tail are precedence-derived, hence unavoidable.
    """
    n = len(tasks)
    outgoing, incoming = [[] for _ in tasks], [[] for _ in tasks]
    for before, after in edges:
        outgoing[before].append(after)
        incoming[after].append(before)
    degree = [len(x) for x in incoming]
    ready = deque(i for i in range(n) if degree[i] == 0)
    starts, order = [0] * n, []
    while ready:
        i = ready.popleft()
        order.append(i)
        end = starts[i] + tasks[i]["duration"]
        for j in outgoing[i]:
            starts[j] = max(starts[j], end)
            degree[j] -= 1
            if degree[j] == 0:
                ready.append(j)
    if len(order) != n:
        return None
    tails = [0] * n
    for i in reversed(order):
        tails[i] = max((tasks[j]["duration"] + tails[j] for j in outgoing[i]), default=0)
    lower = max(starts[i] + tasks[i]["duration"] for i in range(n))
    by_resource = defaultdict(list)
    for i, task in enumerate(tasks):
        by_resource[task["resource"]].append(i)
    for resource, members in by_resource.items():
        cap = capacities[resource]
        for release in {starts[i] for i in members}:
            relevant = [i for i in members if starts[i] >= release]
            for tail in {tails[i] for i in relevant}:
                work = sum(tasks[i]["duration"] for i in relevant if tails[i] >= tail)
                lower = max(lower, release + (work + cap - 1) // cap + tail)
    return lower, starts, tails, incoming, outgoing


def _earliest_slot(release, duration, intervals, capacity):
    candidates = sorted({release} | {end for start, end, _ in intervals if end >= release})
    for start in candidates:
        end = start + duration
        events = defaultdict(int)
        active = 0
        for left, right, _ in intervals:
            if right <= start or left >= end:
                continue
            if left <= start:
                active += 1
            else:
                events[left] += 1
            if right < end:
                events[right] -= 1
        if active >= capacity:
            continue
        valid = True
        for moment in sorted(events):
            active += events[moment]
            if active >= capacity:
                valid = False
                break
        if valid:
            return start
    raise RuntimeError("No placement after the last resource booking")


def _feasible_upper(tasks, edges, capacities, bounds):
    _, _, tails, incoming, outgoing = bounds
    best = None
    for variant in range(8):
        degree = [len(x) for x in incoming]
        ready = {i for i, degree_i in enumerate(degree) if degree_i == 0}
        starts, ends = {}, {}
        intervals = defaultdict(list)
        while ready:
            placements = {}
            for i in ready:
                release = max((ends[p] for p in incoming[i]), default=0)
                task = tasks[i]
                placements[i] = _earliest_slot(release, task["duration"],
                                                intervals[task["resource"]], capacities[task["resource"]])

            def priority(i):
                task, earliest = tasks[i], placements[i]
                duration, tail = task["duration"], tails[i]
                choices = [(-tail-duration, -duration, earliest),
                           (earliest, -tail-duration, -duration),
                           (-duration, -tail, earliest),
                           (duration, -tail, earliest),
                           (task["resource"], -tail, earliest),
                           (earliest+duration, -tail, -duration),
                           (-tail, duration, earliest),
                           (task["product_key"], earliest, -tail)]
                return choices[variant] + (i,)

            i = min(ready, key=priority)
            ready.remove(i)
            task = tasks[i]
            starts[i], ends[i] = placements[i], placements[i] + task["duration"]
            intervals[task["resource"]].append((starts[i], ends[i], i))
            for j in outgoing[i]:
                degree[j] -= 1
                if degree[j] == 0:
                    ready.add(j)
        span = max(ends.values())
        if best is None or span < best[0]:
            best = span, starts
    return best


def _conflict(tasks, starts, capacities, tails):
    by_resource = defaultdict(list)
    for i, task in enumerate(tasks):
        by_resource[task["resource"]].append(i)
    conflicts = []
    for resource, members in by_resource.items():
        capacity = capacities[resource]
        for moment in sorted({starts[i] for i in members}):
            active = [i for i in members if starts[i] <= moment < starts[i] + tasks[i]["duration"]]
            if len(active) > capacity:
                active.sort(key=lambda i: (-tails[i], -tasks[i]["duration"], i))
                clique = active[:capacity+1]
                conflicts.append((capacity, -max(tails[i] for i in clique), moment, clique))
                break
    if not conflicts:
        return None
    return min(conflicts)[-1]


def _schedule(tasks, base_edges, lands, denominator, time_limit_seconds, node_limit):
    capacities = {task["resource"]: 1 for task in tasks}
    capacities["__land__"] = lands
    initial = _dag_bounds(tasks, base_edges, capacities)
    initial_lower = initial[0]
    upper, best_starts = _feasible_upper(tasks, base_edges, capacities, initial)
    started = clock.monotonic()
    serial, nodes = 0, 0
    queue = [(initial_lower, serial, base_edges, initial)]
    visited = {base_edges}
    stopped = False
    while queue and queue[0][0] < upper:
        if nodes >= node_limit or clock.monotonic() - started >= time_limit_seconds:
            stopped = True
            break
        lower, _, edges, bounds = heapq.heappop(queue)
        nodes += 1
        clique = _conflict(tasks, bounds[1], capacities, bounds[2])
        if clique is None:
            candidate = max(bounds[1][i] + task["duration"] for i, task in enumerate(tasks))
            if candidate < upper:
                upper, best_starts = candidate, {i: value for i, value in enumerate(bounds[1])}
            continue
        # For any capacity+1 overlapping intervals, a feasible interval schedule
        # must make at least one pair disjoint (the interval Helly property).
        # Both possible orders of every pair form a complete branching cover.
        for i, j in combinations(clique, 2):
            for before, after in ((i, j), (j, i)):
                augmented = edges | {(before, after)}
                if augmented in visited:
                    continue
                visited.add(augmented)
                child = _dag_bounds(tasks, augmented, capacities)
                if child is None or child[0] >= upper:
                    continue
                serial += 1
                heapq.heappush(queue, (child[0], serial, augmented, child))
    certified_lower = min(upper, queue[0][0]) if queue else upper
    exact = certified_lower == upper
    if exact:
        proof = "lower_bound_equals_feasible_schedule" if initial_lower == upper else "complete_disjunctive_search"
    else:
        proof = "bounded_search_time_or_node_limit" if stopped else "lower_and_upper_bounds"
    schedule = []
    for i in sorted(best_starts, key=lambda x: (best_starts[x], tasks[x]["resource"], x)):
        task = tasks[i]
        schedule.append({"task_id": i, "product_id": task["product_id"], "name": task["name"],
                         "resource": "土地" if task["resource"] == "__land__" else task["resource"],
                         "start_minutes": _number(Fraction(best_starts[i], denominator)),
                         "end_minutes": _number(Fraction(best_starts[i]+task["duration"], denominator))})
    return {"land_count": lands, "lower_bound_minutes": _number(Fraction(certified_lower, denominator)),
            "feasible_minutes": _number(Fraction(upper, denominator)),
            "optimal_minutes": _number(Fraction(upper, denominator)) if exact else None,
            "is_proven_optimal": exact, "proof": proof, "search_nodes": nodes,
            "search_elapsed_seconds": round(clock.monotonic()-started, 4), "schedule": schedule}


def analyze(products, lands_by_level, time_limit_seconds=2.0, node_limit=20000, progress_callback=None):
    """Calculate one-unit metrics for each product at its unlock plot capacity.

    Also calculate the maximum-land comparison when unlock capacity is lower.
    ``cumulative_total_minutes`` includes crop time, every repeated instance,
    and the target's own step; it is resource work, not elapsed waiting time.
    ``distinct_product_types_including_target`` counts inventory varieties.
    ``operation_count`` assumes one start and one collection per task, and is
    therefore a production-operation proxy rather than literal UI taps.
    """
    indexed = _normalise(products)
    land_values = _land_schedule(lands_by_level)
    maximum_lands = land_values[-1][1]
    rows = []
    for target, product in indexed.items():
        if progress_callback:
            progress_callback(len(rows), len(indexed), product.get('name', target))
        tasks, edges, root, denominator = _expand(target, indexed)
        counts = Counter(task["product_key"] for task in tasks)
        crop_count = sum(count for key, count in counts.items() if not indexed[key]["inputs"])
        processing_count = len(tasks)-crop_count
        resource_minutes = defaultdict(Fraction)
        for key, count in counts.items():
            source = indexed[key]
            resource = str(source["building"])
            resource_minutes[resource] += count*source["duration"]
        crop_minutes = sum(count*indexed[key]["duration"] for key, count in counts.items() if not indexed[key]["inputs"])
        total_minutes = sum(resource_minutes.values(), Fraction(0))
        depths = {}

        def depth(key):
            if key not in depths:
                depths[key] = 1+max(depth(child) for child, _ in indexed[key]["inputs"]) if indexed[key]["inputs"] else 0
            return depths[key]

        lands = _lands_at(product["level"], land_values)
        schedule = _schedule(tasks, edges, lands, denominator, time_limit_seconds, node_limit)
        full_schedule = schedule if lands == maximum_lands else _schedule(tasks, edges, maximum_lands, denominator,
                                                                         time_limit_seconds, node_limit)
        rows.append({"id": product["id"], "name": product.get("name", target),
                     "building": product["building"], "level": product["level"],
                     "yield": 1, "depth": depth(target),
                     "bom_including_target": [{"id": indexed[key]["id"], "name": indexed[key].get("name", key),
                                                "quantity": count} for key, count in counts.items()],
                     "cumulative_total_minutes": _number(total_minutes),
                     "cumulative_crop_minutes": _number(crop_minutes),
                     "cumulative_processing_minutes": _number(total_minutes-crop_minutes),
                     "resource_minutes": {key: _number(value) for key, value in resource_minutes.items()},
                     "distinct_product_types_including_target": len(counts),
                     "distinct_product_types_excluding_target": len(counts)-1,
                     "crop_unit_productions": crop_count, "processing_unit_productions": processing_count,
                     "total_production_tasks": len(tasks), "operation_count": 2*len(tasks),
                     "crop_operation_count": 2*crop_count, "processing_operation_count": 2*processing_count,
                     "land_count_at_unlock": lands, "schedule_at_unlock": schedule,
                     "schedule_at_max_lands": full_schedule})
    return {"assumptions": {"initial_inventory": 0, "yield_per_task": 1,
                             "processing_channels_per_building": 1,
                             "crop_parallelism": "available_land_count",
                             "action_duration_minutes": 0,
                             "operation_proxy": "start_and_collect_each_count_as_one",
                             "cumulative_time": "all_unit_resource_minutes_including_target_and_crops",
                             "optimal_time": "zero_stock_nonpreemptive_elapsed_time_if_proven",
                             "scheduled_facilities": "all_required_buildings_available_at_time_zero"},
            "lands_by_level": [{"level": level, "lands": lands} for level, lands in land_values],
            "all_unlock_schedules_proven_optimal": all(row["schedule_at_unlock"]["is_proven_optimal"] for row in rows),
            "products": rows}


def _self_test():
    simple = [{"id": 1, "name": "Wheat", "building": "Farm", "level": 1, "time": 2, "yield": 1, "inputs": []},
              {"id": 2, "name": "Flour", "building": "Mill", "level": 2, "time": 6, "yield": 1, "inputs": [[1, 2]]},
              {"id": 3, "name": "Bread", "building": "Bakery", "level": 3, "time": 10, "yield": 1, "inputs": [[2, 2]]}]
    result = analyze(simple, {1: 6})["products"][-1]
    assert result["cumulative_total_minutes"] == 30
    assert result["crop_unit_productions"] == 4 and result["processing_unit_productions"] == 3
    assert result["operation_count"] == 14 and result["depth"] == 2
    assert result["schedule_at_unlock"]["optimal_minutes"] == 24
    # One land forces four two-minute crop tasks.  The mill can start after
    # two crops, overlap the rest, then process its second flour: 4+12+10=26.
    assert analyze(simple, {1: 1})["products"][-1]["schedule_at_unlock"]["optimal_minutes"] == 26
    # Crops from different branches can be planted simultaneously; mill tasks
    # of different release times share one channel and can be ordered freely.
    delayed = simple[:2] + [
        {"id": 4, "name": "Potato", "building": "Farm", "level": 2, "time": 15, "yield": 1, "inputs": []},
        {"id": 5, "name": "Starch", "building": "Mill", "level": 3, "time": 10, "yield": 1, "inputs": [[4, 1]]},
        {"id": 6, "name": "Mix", "building": "Bakery", "level": 4, "time": 5, "yield": 1, "inputs": [[2, 1], [5, 1]]}]
    assert analyze(delayed, {1: 6})["products"][-1]["schedule_at_unlock"]["optimal_minutes"] == 30
    # Fractional minutes are converted to exact integer ticks.
    fractional = [{"id": "a", "name": "A", "building": "Farm", "level": 1, "time": 0.5, "yield": 1, "inputs": []},
                  {"id": "b", "name": "B", "building": "Mill", "level": 2, "time": 1.25, "yield": 1, "inputs": [["a", 2]]}]
    assert analyze(fractional, {1: 6})["products"][-1]["schedule_at_unlock"]["optimal_minutes"] == 1.75
    # This branch/capacity case requires an ordering decision beyond the first
    # lower bound.  It has a hand-checkable optimal schedule ending at minute8:
    # crops(0..2,0..2,2..4), C(2..3,4..5), B(3..6), A(5..7), final B(7..8).
    branched = [{"id": 0, "name": "crop", "building": "Farm", "level": 1, "time": 2, "yield": 1, "inputs": []},
                {"id": 1, "name": "mid", "building": "C", "level": 2, "time": 1, "yield": 1, "inputs": [[0, 1]]},
                {"id": 3, "name": "left", "building": "B", "level": 4, "time": 3, "yield": 1, "inputs": [[1, 1], [0, 1]]},
                {"id": 4, "name": "right", "building": "A", "level": 5, "time": 2, "yield": 1, "inputs": [[1, 1]]},
                {"id": 6, "name": "end", "building": "B", "level": 7, "time": 1, "yield": 1, "inputs": [[3, 1], [4, 1]]}]
    solved = analyze(branched, {1: 2})["products"][-1]["schedule_at_unlock"]
    assert solved["optimal_minutes"] == 8 and solved["search_nodes"] > 0
    limited = analyze(branched, {1: 2}, time_limit_seconds=0)["products"][-1]["schedule_at_unlock"]
    assert limited["optimal_minutes"] is None and not limited["is_proven_optimal"]
    assert limited["lower_bound_minutes"] <= 8 <= limited["feasible_minutes"]
    print("6 independent schedule and certification cases passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?")
    parser.add_argument("--output")
    parser.add_argument("--time-limit", type=float, default=2.0)
    parser.add_argument("--node-limit", type=int, default=20000)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        _self_test()
    elif args.input:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
        result = analyze(payload["products"], payload["lands_by_level"], args.time_limit, args.node_limit)
        serialized = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(serialized, encoding="utf-8")
        else:
            print(serialized)
    else:
        parser.error("Provide input JSON or --self-test")
