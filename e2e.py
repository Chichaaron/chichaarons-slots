"""End-to-End-Test im echten Browser: Registrierung, Einsätze, Runde, Persistenz."""
import json, math, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:8765"
FAILS = []

def check(name, cond, extra=""):
    if cond:
        print(f"  ✓ {name}")
    else:
        print(f"  ✗ {name} {extra}")
        FAILS.append(name)

def money_to_num(text):
    t = text.replace(" ", " ").replace("€", "").strip()
    t = t.replace(".", "").replace(",", ".")
    return float(t)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(
        "if(!localStorage.getItem('gv_roulette_settings_v1'))"
        "localStorage.setItem('gv_roulette_settings_v1', JSON.stringify({sound:false,speed:'fast'}))"
    )
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

    print("\nStart & Registrierung")
    page.goto(BASE)
    page.wait_for_selector("#screen-auth:not([hidden])", timeout=15000)
    check("Anmeldemaske erscheint", page.is_visible("#screen-auth"))

    page.click('[data-auth-tab="register"]')
    page.fill("#auth-identifier", "testspieler")
    page.fill("#auth-password", "geheim123")
    page.fill("#auth-password2", "geheim123")
    page.click("#auth-submit")
    page.wait_for_selector("#screen-menu:not([hidden])", timeout=15000)
    balance = money_to_num(page.inner_text("#screen-menu [data-balance]"))
    check("Startguthaben 2.000 €", balance == 2000, f"(war {balance})")

    print("\nEinsätze platzieren")
    page.click('[data-nav="game"]')
    page.wait_for_selector("#screen-game:not([hidden])")
    page.click('.chip[data-value="10"]')
    page.click('.cell[data-bet="straight:17"]')
    page.click('.chip[data-value="20"]')
    page.click('.cell[data-bet="red"]')
    page.click('.chip[data-value="50"]')
    page.click('.cell[data-bet="dozen1"]')

    bal_after_bets = page.evaluate("window.__grandVert.balance")
    check("Guthaben nach 80 € Einsatz = 1.920 €", bal_after_bets == 1920, f"(war {bal_after_bets})")
    check("Jeton auf Zahl 17 sichtbar", page.is_visible('.cell[data-bet="straight:17"] .field-chip'))
    check("Jeton auf Rot sichtbar", page.is_visible('.cell[data-bet="red"] .field-chip'))
    check("Einsatzübersicht zeigt 3 Zeilen", page.locator("#bet-list .bet-row").count() == 3)
    check("Gesamteinsatz 80 €", money_to_num(page.inner_text("#bet-total")) == 80)

    # Rückgängig / erneut setzen
    page.click("#btn-undo")
    check("Rückgängig erstattet 50 €", page.evaluate("window.__grandVert.balance") == 1970)
    page.click('.chip[data-value="50"]')
    page.click('.cell[data-bet="dozen1"]')
    check("Wieder 1.920 € nach erneutem Setzen", page.evaluate("window.__grandVert.balance") == 1920)

    print("\nZu hoher Einsatz wird abgelehnt")
    page.fill("#custom-amount", "999999")
    page.click("#btn-custom")
    time.sleep(0.3)
    page.fill("#custom-amount", "5000")
    page.click("#btn-custom")
    page.click('.cell[data-bet="black"]')
    check("Einsatz über dem Guthaben wird nicht angenommen",
          page.evaluate("window.__grandVert.balance") == 1920)
    check("Kein Jeton auf Schwarz", not page.is_visible('.cell[data-bet="black"] .field-chip'))
    page.click('.chip[data-value="10"]')

    print("\nRunde drehen")
    page.click("#btn-ride")
    page.wait_for_selector("#summary-modal:not([hidden])", timeout=30000)

    data = page.evaluate("""() => ({
        landing: window.__grandVert.landing,
        round: window.__grandVert.lastRound,
        balance: window.__grandVert.balance,
        phase: window.__grandVert.phase
    })""")
    winning = data["round"]["winning"]
    landing = data["landing"]

    # Kugel muss physisch in der Tasche der Gewinnzahl liegen
    diff = abs(((landing["ballAngle"] - landing["pocketWorldAngle"] + math.pi) % (2 * math.pi)) - math.pi)
    check(f"Kugel landet exakt in der Tasche von {winning}", diff < 1e-9, f"(Abweichung {diff:.2e} rad)")

    # Auszahlung nachrechnen
    expected_return = 0
    for r in data["round"]["results"]:
        expected_return += r["payout"]
    check("Rückzahlung stimmt mit der Summe der Einzelwetten überein",
          abs(data["round"]["returned"] - expected_return) < 1e-9)
    expected_balance = 1920 + data["round"]["returned"]
    check(f"Guthaben nach Runde korrekt ({expected_balance} €)",
          abs(data["balance"] - expected_balance) < 1e-9, f"(war {data['balance']})")

    check("Gewinnzahl wird in der Auswertung angezeigt",
          page.inner_text("#summary-ball").strip() == str(winning))
    check("Ergebnisspalte gefüllt", page.locator("#bet-list .bet-result.win, #bet-list .bet-result.loss").count() == 3)

    print("\nNächste Runde")
    page.click("#summary-next")
    page.wait_for_selector("#summary-modal", state="hidden")
    check("Wetten wurden geleert", page.locator("#bet-list .bet-row").count() == 0)
    check("Phase wieder 'betting'", page.evaluate("window.__grandVert.phase") == "betting")
    page.click('.chip[data-value="10"]')
    page.click('.cell[data-bet="even"]')
    check("Neue Runde kann gesetzt werden", page.locator("#bet-list .bet-row").count() == 1)
    page.click("#btn-clear")

    saved_balance = page.evaluate("window.__grandVert.balance")

    print("\nPersistenz")
    page.reload()
    page.wait_for_selector("#screen-menu:not([hidden])", timeout=15000)
    reloaded = money_to_num(page.inner_text("#screen-menu [data-balance]"))
    check(f"Nach Neuladen weiterhin {saved_balance} €", reloaded == saved_balance, f"(war {reloaded})")

    page.click("#btn-logout")
    page.wait_for_selector("#screen-auth:not([hidden])")
    page.fill("#auth-identifier", "testspieler")
    page.fill("#auth-password", "geheim123")
    page.click("#auth-submit")
    page.wait_for_selector("#screen-menu:not([hidden])", timeout=15000)
    after_login = money_to_num(page.inner_text("#screen-menu [data-balance]"))
    check(f"Nach erneuter Anmeldung weiterhin {saved_balance} €", after_login == saved_balance, f"(war {after_login})")

    print("\nFalsches Passwort")
    page.click("#btn-logout")
    page.wait_for_selector("#screen-auth:not([hidden])")
    page.fill("#auth-identifier", "testspieler")
    page.fill("#auth-password", "falsches-passwort")
    page.click("#auth-submit")
    page.wait_for_selector("#auth-error:not([hidden])", timeout=10000)
    check("Login mit falschem Passwort schlägt fehl", page.is_visible("#auth-error"))

    page.fill("#auth-password", "geheim123")
    page.click("#auth-submit")
    page.wait_for_selector("#screen-menu:not([hidden])", timeout=15000)

    print("\nScreenshots")
    page.click('[data-nav="game"]')
    page.wait_for_selector("#screen-game:not([hidden])")
    page.click('.chip[data-value="20"]')
    for bet in ["straight:17", "straight:5", "red", "dozen2", "col1"]:
        page.click(f'.cell[data-bet="{bet}"]')
    time.sleep(0.6)
    page.screenshot(path="tests/shot-table.png")
    page.click("#btn-ride")
    time.sleep(2.0)
    page.screenshot(path="tests/shot-wheel.png")
    page.wait_for_selector("#summary-modal:not([hidden])", timeout=30000)
    page.screenshot(path="tests/shot-summary.png")
    page.click("#summary-next")

    page.click('[data-nav="menu"]')
    page.wait_for_selector("#screen-menu:not([hidden])")
    time.sleep(0.6)
    page.screenshot(path="tests/shot-menu.png")

    print("\nKonto löschen")
    page.click('[data-nav="settings"]')
    page.click("#btn-delete")
    page.wait_for_selector("#confirm-modal:not([hidden])")
    page.click("#confirm-yes")
    page.wait_for_selector("#screen-auth:not([hidden])", timeout=10000)
    users = page.evaluate("JSON.parse(localStorage.getItem('gv_roulette_users_v1')||'{}')")
    check("Konto ist aus dem Speicher entfernt", "testspieler" not in users)

    real_errors = [e for e in errors if "favicon" not in e.lower()]
    check("Keine JavaScript-Fehler", not real_errors, f"\n    {real_errors[:5]}")

    browser.close()

print(f"\n{'ALLE TESTS BESTANDEN' if not FAILS else 'FEHLGESCHLAGEN: ' + ', '.join(FAILS)}\n")
sys.exit(1 if FAILS else 0)
