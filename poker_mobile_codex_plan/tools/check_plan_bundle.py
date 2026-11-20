#!/usr/bin/env python3
"""Validate the execution pack, not a mobile application or solver implementation."""
from pathlib import Path
from itertools import combinations
from collections import Counter
from math import comb, isclose
import argparse
import json
import sys

try:
    from jsonschema import Draft202012Validator
except ImportError:
    raise SystemExit("Missing jsonschema. Install tools/requirements-validation.txt in a project virtual environment.")

parser=argparse.ArgumentParser()
parser.add_argument("--root",type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument("--report",type=Path)
args=parser.parse_args()
root=args.root.resolve()
checks=0

def require(condition,message):
    global checks
    checks+=1
    if not condition:
        raise AssertionError(message)

def read(rel):
    def reject_constant(value):
        raise ValueError("Non-finite JSON number: "+value)
    return json.loads((root/rel).read_text(encoding="utf-8"),parse_constant=reject_constant)

schemas={}
for p in sorted((root/"schemas").glob("*.schema.json")):
    s=read(p.relative_to(root))
    Draft202012Validator.check_schema(s)
    schemas[p.name]=s
    require(True,"schema self-check")

request_v=Draft202012Validator(schemas["analysis_request.schema.json"])
result_v=Draft202012Validator(schemas["analysis_result.schema.json"])
progress_v=Draft202012Validator(schemas["analysis_progress.schema.json"])
error_v=Draft202012Validator(schemas["analysis_error.schema.json"])
definitions=schemas["analysis_result.schema.json"]["$defs"]

def sub_v(name):
    return Draft202012Validator({"$schema":"https://json-schema.org/draft/2020-12/schema","$defs":definitions,"$ref":"#/$defs/"+name})

def close(a,b,message):
    require(isclose(a,b,rel_tol=0,abs_tol=1e-12),message)

def cid(c):
    return "23456789TJQKA".index(c[0])*4+"cdhs".index(c[1])

def check_stats(s):
    w,t,l,n=(s[k] for k in ("wins","ties","losses","total"))
    require(w+t+l==n,"counts must sum to total")
    close(s["win_probability"],w/n,"win probability")
    close(s["tie_probability"],t/n,"tie probability")
    close(s["loss_probability"],l/n,"loss probability")
    close(s["equity"],(2*w+t)/(2*n),"equity")
    close(s["win_probability"]+s["tie_probability"]+s["loss_probability"],1,"probability sum")

def semantic_error(req):
    known=req["hero"]+req["board"]+(req.get("villain") or [])
    if len(set(known))!=len(known):
        return "DUPLICATE_KNOWN_CARD"
    if req["mode"]=="combo_analysis" and req["range"]["kind"]=="weighted":
        rows=req["range"]["combos"]
        keys=[tuple(sorted(row["cards"])) for row in rows]
        if len(set(keys))!=len(keys):
            return "DUPLICATE_RANGE_COMBO"
        effective=[x for x in rows if not set(x["cards"]) & set(known) and x["weight"]>0]
        if not effective:
            return "EMPTY_EFFECTIVE_RANGE"
    return None

# Independent five-card evaluator used only to verify the river fixture.
def rank5(cards):
    ranks=[cid(c)//4+2 for c in cards]
    counts=Counter(ranks)
    ordered=sorted(ranks,reverse=True)
    unique=sorted(counts)
    straight=0
    if len(unique)==5:
        if unique[-1]-unique[0]==4:
            straight=unique[-1]
        elif unique==[2,3,4,5,14]:
            straight=5
    flush=len({c[1] for c in cards})==1
    groups=sorted(((n,r) for r,n in counts.items()),reverse=True)
    if flush and straight:return (8,straight)
    if groups[0][0]==4:return (7,groups[0][1],groups[1][1])
    if [x[0] for x in groups]==[3,2]:return (6,groups[0][1],groups[1][1])
    if flush:return (5,*ordered)
    if straight:return (4,straight)
    if groups[0][0]==3:return (3,groups[0][1],*sorted((r for r,n in counts.items() if n==1),reverse=True))
    pairs=sorted((r for r,n in counts.items() if n==2),reverse=True)
    if len(pairs)==2:return (2,*pairs,next(r for r,n in counts.items() if n==1))
    if len(pairs)==1:return (1,pairs[0],*sorted((r for r,n in counts.items() if n==1),reverse=True))
    return (0,*ordered)

def best(cards):
    return max(rank5(c) for c in combinations(cards,5))

complete_results=0
for filename in ("preflop_asah_kskh.json","river_weighted_filtering.json"):
    fixture=read("fixtures/"+filename)
    req,out=fixture["request"],fixture["expected_result"]
    request_v.validate(req)
    result_v.validate(out)
    require(semantic_error(req) is None,"valid fixture semantics")
    require(req["request_id"]==out["request_id"],"request binding")
    complete_results+=1
    if req["mode"]=="preflop_fixed":
        check_stats(out["hero"]);check_stats(out["villain"])
        h,v=out["hero"],out["villain"]
        require(h["total"]==comb(48,5)==out["total_evaluations"],"preflop combinatorics")
        require((h["wins"],h["ties"],h["losses"])==(v["losses"],v["ties"],v["wins"]),"opposite perspective")
        close(h["equity"]+v["equity"],1,"heads-up equity sum")
        require(2*h["wins"]+h["ties"]==fixture["assertions"]["hero_equity_numerator"],"equity numerator")
        require(2*h["total"]==fixture["assertions"]["equity_denominator"],"equity denominator")
    else:
        known=set(req["hero"]+req["board"])
        supplied=req["range"]["combos"]
        blocked=[x for x in supplied if set(x["cards"])&known]
        zero=[x for x in supplied if not set(x["cards"])&known and x["weight"]==0]
        effective=[x for x in supplied if not set(x["cards"])&known and x["weight"]>0]
        rows=out["rows"]
        require(len(blocked)==out["excluded_blocked_combo_count"],"blocked filtering")
        require(len(zero)==out["excluded_zero_weight_combo_count"],"zero filtering")
        require(len(effective)==len(rows)==out["evaluated_combo_count"],"effective rows")
        require(out["available_legal_combo_count"]==comb(52-len(known),2),"available combos")
        close(sum(x["weight"] for x in effective),out["range_weight_sum"],"range weight sum")
        relation_counts=Counter()
        expected_keys={tuple(sorted(x["cards"],key=cid)):x["weight"] for x in effective}
        require([tuple(map(cid,x["cards"])) for x in rows]==sorted(tuple(map(cid,x["cards"])) for x in rows),"row order")
        hero_rank=best(req["hero"]+req["board"])
        for row in rows:
            check_stats(row)
            key=tuple(row["cards"])
            require(key in expected_keys,"row presence")
            require(row["cards"]==sorted(row["cards"],key=cid),"canonical row cards")
            close(row["weight"],expected_keys[key],"row weight")
            opp=best(row["cards"]+req["board"])
            rel="winning" if hero_rank>opp else "losing" if hero_rank<opp else "tied"
            require(row["current_relation"]==rel,"independent river relation")
            require(row["total"]==1,"river denominator")
            require(row[{"winning":"wins","tied":"ties","losing":"losses"}[rel]]==1,"independent river outcome")
            relation_counts[rel]+=1
        require(dict(relation_counts)==out["current_relation_counts"],"relation counts")
        require(sum(x["total"] for x in rows)==out["total_evaluations"],"total evaluations")
        for field in ("win_probability","tie_probability","loss_probability","equity"):
            expected=sum(x["weight"]*x[field] for x in rows)/out["range_weight_sum"]
            close(out["aggregate"][field],expected,"weighted "+field)

river=read("fixtures/river_asqs_qd8s2s7h3c.json")
request_v.validate(river["request"])
summary=river["expected_summary"]
sub_v("combo_summary").validate(summary)
req=river["request"]
known=set(req["hero"]+req["board"])
deck=[r+s for r in "23456789TJQKA" for s in "cdhs" if r+s not in known]
hero_rank=best(req["hero"]+req["board"])
relations={}
counts=Counter()
loss_categories=Counter()
for hand in combinations(deck,2):
    opp_rank=best(list(hand)+req["board"])
    relation="winning" if hero_rank>opp_rank else "losing" if hero_rank<opp_rank else "tied"
    relations[tuple(sorted(hand,key=cid))]=relation
    counts[relation]+=1
    if relation=="losing":loss_categories[opp_rank[0]]+=1
require(len(relations)==990,"complete river opponent enumeration")
require(dict(counts)==summary["current_relation_counts"],"river independent 884/6/100")
require(loss_categories==Counter({3:13,2:78,1:9}),"river loss categories")
for row in river["selected_rows"]:
    sub_v("combo_row").validate(row)
    check_stats(row)
    require(row["current_relation"]==relations[tuple(row["cards"])],"selected row independent verification")
for field,expect in {
    "win_probability":counts["winning"]/990,
    "tie_probability":counts["tied"]/990,
    "loss_probability":counts["losing"]/990,
    "equity":(counts["winning"]+counts["tied"]/2)/990
}.items():
    close(summary["aggregate"][field],expect,"river aggregate "+field)
require(not result_v.is_valid(summary),"river summary is not full response")
require(river["assertions"]["selected_rows_are_not_full_result"],"summary fixture label")

for case in read("fixtures/scenario_counts.json")["cases"]:
    b=case["board_count"]
    opp=1 if case["mode"]=="preflop_fixed" else comb(50-b,2)
    runouts=comb(48,5) if b==0 else comb(48-b,5-b)
    require(case["opponent_combo_count"]==opp,"opponent count")
    require(case["runouts_per_combo"]==runouts,"runout count")
    require(case["total_evaluations"]==opp*runouts,"terminal count")

invalid_cases=read("fixtures/runtime_invalid_cases.json")["cases"]
for case in invalid_cases:
    req=case["request"]
    if case["validation_level"]=="schema":
        require(not request_v.is_valid(req),"schema rejection "+case["case_id"])
        require(case["expected_error_code"]=="INVALID_REQUEST","schema error code")
    else:
        request_v.validate(req)
        require(semantic_error(req)==case["expected_error_code"],"semantic rejection "+case["case_id"])

for msg in read("fixtures/progress_examples.json")["examples"]:
    progress_v.validate(msg)
    require(not result_v.is_valid(msg),"unfinished is not completed")
    extra=dict(msg,equity=0.5)
    require(not progress_v.is_valid(extra),"no probabilities in progress")
    if msg["total_evaluations"] is not None:
        require(0<=msg["completed_evaluations"]<=msg["total_evaluations"],"progress bounds")
rejected={"schema_version":1,"status":"rejected","error":{"code":"INVALID_REQUEST","message":"Invalid input."}}
error_v.validate(rejected)
require(not progress_v.is_valid(rejected),"pre-job rejection is separate")

gto=read("fixtures/gto_river_small_v1.json")
require(len(gto["board"])==5 and len(set(gto["board"]))==5,"GTO river board")
for side in ("oop_range","ip_range"):
    entries=gto[side]
    require(len(entries)>1,"nontrivial GTO range")
    keys=set()
    for entry in entries:
        cards=entry["cards"]
        require(len(cards)==2 and len(set(cards))==2,"GTO private pair")
        require(not set(cards)&set(gto["board"]),"GTO board blockers")
        require(0<entry["weight"]<=1,"GTO positive weight")
        keys.add(tuple(sorted(cards)))
    require(len(keys)==len(entries),"GTO unique combos")
compatible_pairs=sum(not set(a["cards"])&set(b["cards"]) for a in gto["oop_range"] for b in gto["ip_range"])
require(compatible_pairs>0,"GTO nonempty joint distribution")
invalid=gto["invalid_joint_range_case"]
invalid_pairs=sum(not set(a["cards"])&set(b["cards"]) for a in invalid["oop_range"] for b in invalid["ip_range"])
require(invalid_pairs==0 and invalid["expected_error_code"]=="EMPTY_JOINT_RANGE","GTO rejects empty joint distribution")
close(gto["acceptance"]["maximum_exploitability_chips"],
      gto["root_pot"]*gto["acceptance"]["maximum_exploitability_pot_fraction"],"GTO precision units")
require(gto["acceptance"]["independent_best_response_required"] and gto["acceptance"]["timeout_is_not_a_pass"],"GTO real convergence gate")

tasks=read("TASKS.json")["tasks"]
ids={x["id"] for x in tasks}
require(len(ids)==len(tasks),"unique task ids")
done=set()
for task in tasks:
    require(task["status"]=="planned","pack has no pretend completed tasks")
    require(set(task["depends_on"])<=done,"task ordering and acyclic dependency")
    require(task["deliverables"] and task["acceptance"],"task has executable gate")
    done.add(task["id"])

for rel in ("README.md","START_CODEX.txt","CODEX_EXECUTION_PLAN.md","TASKS.json",
            "docs/API_AND_FFI.md","docs/GTO_RIVER_SPEC.md","docs/VERIFICATION_AND_RELEASE.md","docs/SOURCES.md"):
    require((root/rel).is_file(),"required file "+rel)

report={
 "status":"passed",
 "scope":"Execution-pack schema, fixture consistency, task dependencies, and independent river verification. No mobile app or GTO engine has been built by this check.",
 "checks":checks,
 "schemas":len(schemas),
 "fixtures":len(list((root/"fixtures").glob("*.json"))),
 "tasks":len(tasks),
 "complete_result_fixtures":complete_results,
 "gto_benchmark_compatible_pairs":compatible_pairs,
 "independently_enumerated_river_combos":len(relations),
 "river_counts":dict(counts),
 "preflop_check":"Stored exact fixture arithmetic checked; full production enumeration remains an implementation acceptance gate."
}
if args.report:
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(report,ensure_ascii=False,indent=2))
