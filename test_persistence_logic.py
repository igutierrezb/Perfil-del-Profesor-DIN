
def has_data(d):
    p=d.get("profile",{})
    return bool(p.get("nombres") or d.get("answers") or d.get("programMeta") or d.get("planningByPeriod") or d.get("submittedPeriod") or d.get("finalizedAtMs"))

def remote_should(remote, local):
    if remote.get("deletedByAdmin") is True: return False
    rh,lh=has_data(remote),has_data(local)
    if not rh:return False
    if not lh:return True
    rr,lr=int(remote.get("dataRevision",0)),int(local.get("dataRevision",0))
    ru=int(remote.get("clientUpdatedAt",0))
    lu=int(local.get("localUpdatedAt",local.get("savedAt",0)))
    if rr>0 and lr>0:
        if rr!=lr:return rr>lr
        return ru>lu+250
    return ru>lu+250

cases=[
 ("remote newer revision", {"profile":{"nombres":"A"},"dataRevision":12,"clientUpdatedAt":2000},{"profile":{"nombres":"A"},"dataRevision":11,"localUpdatedAt":3000},True),
 ("local newer revision", {"profile":{"nombres":"A"},"dataRevision":11,"clientUpdatedAt":4000},{"profile":{"nombres":"A"},"dataRevision":12,"localUpdatedAt":3000},False),
 ("empty remote cannot erase local", {"dataRevision":13,"clientUpdatedAt":5000},{"profile":{"nombres":"A"},"answers":{"x":1},"dataRevision":12,"localUpdatedAt":3000},False),
 ("remote restores empty local", {"profile":{"nombres":"A"},"answers":{"x":1},"dataRevision":5,"clientUpdatedAt":2000},{},True),
 ("same revision newer remote date", {"profile":{"nombres":"A"},"dataRevision":5,"clientUpdatedAt":5000},{"profile":{"nombres":"A"},"dataRevision":5,"localUpdatedAt":3000},True),
]
for name,r,l,expected in cases:
    got=remote_should(r,l)
    assert got==expected,(name,got,expected)
print("OK:",len(cases),"pruebas de precedencia superadas")
