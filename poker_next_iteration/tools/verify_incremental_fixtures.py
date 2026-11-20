#!/usr/bin/env python3
"""Verify plan fixtures and dependencies, not an application or a solved GTO strategy."""
from pathlib import Path
from itertools import combinations
from collections import Counter
from fractions import Fraction
from math import comb
import json
import argparse

parser=argparse.ArgumentParser()
parser.add_argument("--root",type=Path,default=Path(__file__).resolve().parents[1])
args=parser.parse_args()
root=args.root.resolve()
checks=0
comparisons=0
def require(ok,message):
    global checks
    checks+=1
    if not ok:
        raise AssertionError(message)
def load(path):
    return json.loads((root/path).read_text(encoding="utf-8"))
def f(value):
    return Fraction(value["numerator"],value["denominator"])
deck=[r+s for r in "23456789TJQKA" for s in "cdhs"]

def cid(c):
    return "23456789TJQKA".index(c[0])*4+"cdhs".index(c[1])

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

# Task graph and scope consistency.
manifest=load("NEXT_TASKS.json")
tasks=manifest["tasks"]
ids={t["id"] for t in tasks}
require(len(ids)==len(tasks),"duplicate task IDs")
resolved=set()
while len(resolved)<len(ids):
    ready={t["id"] for t in tasks if t["id"] not in resolved and set(t["depends_on"])<=resolved}
    require(bool(ready),"invalid dependency or cycle")
    resolved |= ready
for t in tasks:
    require(t["id"] in manifest["scopes"][t["scope"]],"scope mismatch")
    require(t["status"]=="planned","plan must not claim implementation passed")
require(manifest["reported_baseline"]["repository_audit_performed_for_this_plan"] is False,"audit claim")
all_scoped=[x for group in manifest["scopes"].values() for x in group]
require(set(all_scoped)==ids and len(all_scoped)==len(ids),"scope coverage")

fixture_summaries=[]
for name in ["turn_weighted_blocker_v1","flop_weighted_v1","turn_current_tie_v1"]:
    data=load("fixtures/"+name+".json")
    req=data["request"]; expected=data["expected"]
    hero=req["hero"]; board=req["board"]; known=set(hero+board)
    require(len(known)==len(hero)+len(board),"duplicate known card")
    rows=expected["rows"]
    weights=[Fraction(str(r["weight"])) for r in rows]
    total_weight=sum(weights)
    require(total_weight>0,"empty range")
    aggregates=[Fraction(0),Fraction(0),Fraction(0)]
    next_mass={c:Fraction(0) for c in deck if c not in known}
    next_equity_mass={c:Fraction(0) for c in next_mass}
    k=5-len(board)
    for row,weight in zip(rows,weights):
        villain=row["cards"]
        remaining=[c for c in deck if c not in known and c not in villain]
        n=comb(len(remaining),k)
        require(n==row["total"],"runout count")
        require(len(set(villain))==2 and not(set(villain)&known),"invalid opponent")
        require(0<weight<=1,"weight bound")
        current=(best(hero+board)>best(villain+board))-(best(hero+board)<best(villain+board))
        relation={1:"winning",0:"tied",-1:"losing"}[current]
        require(relation==row["current_relation"],"current relation")
        counts=[0,0,0]
        winning_rivers=[]
        for runout in combinations(remaining,k):
            a=best(hero+board+list(runout)); b=best(villain+board+list(runout))
            outcome=0 if a>b else (1 if a==b else 2)
            counts[outcome]+=1
            comparisons+=1
            share=[Fraction(1),Fraction(1,2),Fraction(0)][outcome]
            mass=weight/(total_weight*n)
            for card in runout:
                next_mass[card]+=mass/k
                next_equity_mass[card]+=mass*share/k
            if outcome==0 and k==1:
                winning_rivers.append(runout[0])
        require(counts==[row["wins"],row["ties"],row["losses"]],name+" counts")
        for idx,key in enumerate(["win_probability","tie_probability","loss_probability"]):
            require(Fraction(counts[idx],n)==f(row[key]),name+" row probability")
            aggregates[idx]+=weight/total_weight*Fraction(counts[idx],n)
        require(Fraction(2*counts[0]+counts[1],2*n)==f(row["equity"]),"row equity")
        if "winning_rivers" in expected:
            require(set(winning_rivers)==set(expected["winning_rivers"]),"winning rivers")
    for idx,key in enumerate(["win_probability","tie_probability","loss_probability"]):
        require(aggregates[idx]==f(expected["aggregate"][key]),"aggregate probability")
    equity=aggregates[0]+aggregates[1]/2
    require(equity==f(expected["aggregate"]["equity"]),"aggregate equity")
    require(sum(next_mass.values())==1,"next card probability normalization")
    require(sum(next_equity_mass.values())==equity,"law of total equity")
    # Independently check chance-card mass from blockers.
    N=50-len(board)
    for card,p in next_mass.items():
        expected_p=sum(w for row,w in zip(rows,weights) if card not in row["cards"])/((N-2)*total_weight)
        require(p==expected_p,"blocker chance probability")
    if "next_card_groups" in expected:
        covered=[]
        for group in expected["next_card_groups"]:
            for card in group["cards"]:
                covered.append(card)
                require(next_mass[card]==f(group["per_card_probability"]),"next group probability")
                conditional=next_equity_mass[card]/next_mass[card]
                require(conditional==f(group["conditional_equity"]),"next group equity")
                require(conditional-equity==f(group["delta_equity"]),"next group delta")
        require(len(covered)==len(set(covered)) and set(covered)==set(next_mass),"next group coverage")
    for selected in expected.get("selected_next_cards",[]):
        c=selected["card"]
        require(next_mass[c]==f(selected["probability"]),"selected next probability")
        require(next_equity_mass[c]/next_mass[c]==f(selected["conditional_equity"]),"selected conditional equity")
    fixture_summaries.append({"fixture_id":name,"equity_fraction":str(equity),"status":"passed"})

zero=load("fixtures/next_card_impossible_v1.json")
for item in zero["expected_next_cards"]:
    require(all(item["card"] in row["cards"] for row in zero["opponent_range"]),"zero probability blocker")
    require(f(item["probability"])==0 and item["conditional_equity"] is None and item["delta_equity"] is None,"impossible card semantics")

gto=load("fixtures/gto_river_small_v1.json")
pairs=sum(1 for a in gto["oop_range"] for b in gto["ip_range"] if not set(a["cards"])&set(b["cards"]))
require(pairs==60,"inherited GTO joint pair count")
require(gto["acceptance"]["maximum_exploitability_pot_fraction"]==.001,"GTO target")
require(comb(46,2)*44==45540,"turn full range size")
require(comb(47,2)*comb(45,2)==1070190,"flop full range size")
require(comb(50,2)*comb(48,5)==2097572400,"preflop hero-versus-uniform scope")
report={
    "artifact_role":"plan_reference_validation_only",
    "application_validated":False,
    "gto_strategy_solved":False,
    "task_count":len(tasks),
    "checks_passed":checks,
    "independent_terminal_comparisons":comparisons,
    "fixtures":fixture_summaries,
    "gto_model_compatible_joint_pairs":pairs
}
(root/"verification").mkdir(exist_ok=True)
(root/"verification"/"plan_consistency.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(report,ensure_ascii=False))
