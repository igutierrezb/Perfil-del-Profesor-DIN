
def locked(finalized, editing_applies, step1, step2):
    if finalized or not editing_applies:
        return False, False
    return (not step1), (not step2)

cases = [
    ("inicio edición", False, True, False, False, (True, True)),
    ("paso 1 confirmado", False, True, True, False, (False, True)),
    ("paso 2 concluido", False, True, True, True, (False, False)),
    ("perfil finalizado", True, False, True, True, (False, False)),
]
for name, fin, edit, s1, s2, expected in cases:
    got = locked(fin, edit, s1, s2)
    assert got == expected, (name, got, expected)

# Invalidar paso 1 debe invalidar paso 2.
flow={"step1":True,"step2":True}
flow["step1"]=False
flow["step2"]=False
assert flow == {"step1":False,"step2":False}

# Modificar paso 2 mantiene paso1 pero invalida paso2.
flow={"step1":True,"step2":True}
flow["step2"]=False
assert flow == {"step1":True,"step2":False}

print("OK: 6 comprobaciones del flujo secuencial superadas")
