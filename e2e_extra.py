"""Zusätzliche Browser-Tests: Wiederholen, Pleite-Hilfe, Einstellungen, Unterseiten."""
import sys, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765"
FAILS = []

def check(name, cond, extra=""):
    print(f"  {'✓' if cond else '✗'} {name} {extra if not cond else ''}")
    if not cond: FAILS.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script("if(!localStorage.getItem('gv_roulette_settings_v1'))"
        "localStorage.setItem('gv_roulette_settings_v1', JSON.stringify({sound:false,speed:'fast'}))")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    page.wait_for_selector("#screen-auth:not([hidden])", timeout=15000)
    page.click('[data-auth-tab="register"]')
    page.fill("#auth-identifier", "extra"); page.fill("#auth-password", "geheim123"); page.fill("#auth-password2", "geheim123")
    page.click("#auth-submit")
    page.wait_for_selector("#screen-menu:not([hidden])", timeout=15000)
    page.click("#screen-menu [data-nav=\"game\"]"); page.wait_for_selector("#screen-game:not([hidden])")

    print("\nEinsätze wiederholen")
    page.click('.chip[data-value="50"]')
    page.click('.cell[data-bet="red"]'); page.click('.cell[data-bet="dozen3"]')
    page.click("#btn-ride")
    page.wait_for_selector("#summary-modal:not([hidden])", timeout=30000)
    before = page.evaluate("window.__grandVert.balance")
    page.click("#summary-repeat")
    time.sleep(0.4)
    check("Wiederholen setzt erneut 100 €", page.evaluate("window.__grandVert.staked") == 100)
    check("Guthaben um 100 € reduziert", page.evaluate("window.__grandVert.balance") == before - 100,
          f"(vorher {before}, jetzt {page.evaluate('window.__grandVert.balance')})")
    page.click("#btn-clear")
    check("Löschen erstattet vollständig", page.evaluate("window.__grandVert.balance") == before)

    print("\nBis zur Pleite spielen (alles auf eine Zahl)")
    rounds = 0
    while page.evaluate("window.__grandVert.balance") > 0 and rounds < 25:
        rounds += 1
        bal = page.evaluate("window.__grandVert.balance")
        page.fill("#custom-amount", str(int(bal)))
        page.click("#btn-custom")
        page.click('.cell[data-bet="straight:0"]')
        placed = page.evaluate("window.__grandVert.staked")
        if placed != bal:
            check("Voller Einsatz konnte platziert werden", False, f"({placed} statt {bal})")
            break
        page.click("#btn-ride")
        page.wait_for_selector("#summary-modal:not([hidden])", timeout=40000)
        page.click("#summary-next")
        page.wait_for_selector("#summary-modal", state="hidden")
        time.sleep(0.2)
    bal = page.evaluate("window.__grandVert.balance")
    check(f"Guthaben nach {rounds} Runden bei 0 € (nie negativ)", bal == 0, f"(war {bal})")
    check("Notfall-Guthaben wird angeboten", page.is_visible("#board-hint .btn"))
    page.click("#board-hint .btn")
    time.sleep(0.5)
    check("Notfall-Guthaben gutgeschrieben (500 €)", page.evaluate("window.__grandVert.balance") == 500)
    page.reload(); page.wait_for_selector("#screen-menu:not([hidden])", timeout=15000)
    check("Notfall-Guthaben wurde gespeichert",
          page.evaluate("window.__grandVert.profile.balance") == 500)

    print("\nEinstellungen")
    page.click("#screen-menu [data-nav=\"settings\"]"); page.wait_for_selector("#screen-settings:not([hidden])")
    page.select_option("#set-speed", "cinematic")
    page.check("#set-sound")
    time.sleep(0.3)
    page.screenshot(path="tests/shot-settings.png")

    page.click("#btn-export")
    page.wait_for_selector("#export-modal:not([hidden])", timeout=8000)
    data = page.input_value("#export-json")
    check("Datenexport zeigt Guthaben und Statistik", '"guthaben"' in data and '"statistik"' in data)
    page.click("#export-close")
    page.wait_for_selector("#export-modal", state="hidden")
    page.reload(); page.wait_for_selector("#screen-menu:not([hidden])", timeout=15000)
    page.click("#screen-menu [data-nav=\"settings\"]"); page.wait_for_selector("#screen-settings:not([hidden])")
    check("Tempo-Einstellung bleibt erhalten", page.input_value("#set-speed") == "cinematic")
    check("Sound-Einstellung bleibt erhalten", page.is_checked("#set-sound"))

    print("\nUnterseiten")
    page.click("#screen-settings [data-nav=\"privacy\"]"); page.wait_for_selector("#screen-privacy:not([hidden])")
    time.sleep(0.4)
    page.screenshot(path="tests/shot-privacy.png")
    note = page.inner_text("#privacy-storage-note")
    check("Datenschutzseite nennt den Speicherort", "localStorage" in note or "Supabase" in note)
    page.click("#privacy-back")
    check("Zurück führt zu den Einstellungen", page.is_visible("#screen-settings"))
    page.click("#screen-settings [data-nav=\"menu\"]"); page.wait_for_selector("#screen-menu:not([hidden])")
    page.click("#screen-menu [data-nav=\"shop\"]"); page.wait_for_selector("#screen-shop:not([hidden])")
    time.sleep(0.4)
    page.screenshot(path="tests/shot-shop.png")
    check("Nur ein Bildschirm gleichzeitig sichtbar",
          page.evaluate("()=>[...document.querySelectorAll('.screen')].filter(s=>!s.hidden).length") == 1)

    check("Keine JavaScript-Fehler", not errors, str(errors[:3]))
    b.close()

print(f"\n{'ALLE ZUSATZTESTS BESTANDEN' if not FAILS else 'FEHLGESCHLAGEN: ' + ', '.join(FAILS)}\n")
sys.exit(1 if FAILS else 0)
