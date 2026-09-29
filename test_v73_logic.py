
def review_available(editing, complete, cfg_locked=False, deadline=False, submitted=False, capture_confirmed=False):
    if editing:
        return complete and capture_confirmed
    return complete or cfg_locked or deadline or submitted

assert review_available(True, False, submitted=True, capture_confirmed=False) is False
assert review_available(True, True, submitted=True, capture_confirmed=False) is False
assert review_available(True, True, submitted=True, capture_confirmed=True) is True
assert review_available(False, False, submitted=True) is True

def prev_index(i):
    return 0 if i <= 0 else i-1
assert prev_index(0)==0
assert prev_index(7)==6

def enter_capture(profile_confirmed):
    return 0 if profile_confirmed else None
assert enter_capture(True)==0

print("OK: 7 reglas críticas V73 verificadas")
