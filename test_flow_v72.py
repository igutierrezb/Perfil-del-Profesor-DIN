
def can_review(step2):
    return bool(step2)

def next_expected(expected, before, after, total):
    if before != expected:
        return None
    if after == before + 1:
        return after
    if before == total and after == "revision":
        return "done"
    return expected

assert can_review(False) is False
assert can_review(True) is True
assert next_expected(1,1,2,8) == 2
assert next_expected(2,2,3,8) == 3
assert next_expected(1,8,"revision",8) is None
assert next_expected(8,8,"revision",8) == "done"
assert next_expected(3,3,3,8) == 3
assert next_expected(3,3,8,8) == 3
print("OK: 8 pruebas del recorrido secuencial V72 superadas")
