# Ending a meeting, as every screen sees it (needs a local server with LiveKit and Playwright).
import json, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
BASE="http://localhost:4000"; import tempfile; D=tempfile.gettempdir()
T={"uid":"tchEnd","name":"Shahnawaz"}
req=urllib.request.Request(f"{BASE}/api/sessions",data=json.dumps({"subject":"Weekly team meeting","kind":"meeting"}).encode(),headers={"Content-Type":"application/json","X-Dev-User":urllib.parse.quote(json.dumps(T))})
r=json.loads(urllib.request.urlopen(req).read()); sid=r["session"]["id"]; code=r["session"]["code"]; key=r["boardKey"]
MEDIA=["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required","--allow-loopback-in-peer-connection","--disable-features=WebRtcHideLocalIpsWithMdns"]
G3=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]
fails=[]
def ok(c,w):
    print(("✓ " if c else "✗ ")+w)
    if not c: fails.append(w)
with sync_playwright() as p:
    b=p.chromium.launch(args=MEDIA+["--disable-3d-apis"]); b3=p.chromium.launch(args=MEDIA+G3)
    errs=[]
    h=b.new_page(viewport={"width":1440,"height":860}); h.add_init_script("sessionStorage.setItem('n360.dev.uid','tchEnd');localStorage.setItem('n360.dev.name','Shahnawaz');localStorage.setItem('n360.penIntro','1')")
    h.goto(f"{BASE}/host/{sid}"); h.wait_for_selector(".micbtn:not([disabled])", timeout=20000); h.locator(".micbtn").click()
    h.wait_for_function("() => document.querySelector('.micbtn')?.textContent.includes('On air')", timeout=30000)
    bb=h.locator(".stagev__pane .slate").first.bounding_box(); h.mouse.move(bb["x"]+200,bb["y"]+200); h.mouse.down(); h.mouse.move(bb["x"]+400,bb["y"]+260,steps=8); h.mouse.up()
    def join(br, name, vp, mob=False):
        s=br.new_page(viewport=vp, is_mobile=mob, has_touch=mob); s.on("pageerror",lambda e: errs.append(name+": "+str(e)))
        s.goto(f"{BASE}/join?code={code}"); s.wait_for_timeout(1200); s.get_by_label("Your name").fill(name); s.get_by_role("button", name="Join now").click(); s.wait_for_url("**/live/**"); return s
    a=join(b,"Ayesha",{"width":1366,"height":800}); ph=join(b,"Bilal",{"width":390,"height":844},True); s3=join(b3,"Sana",{"width":1280,"height":760})
    tv=b.new_page(viewport={"width":1600,"height":900}); tv.goto(f"{BASE}/board/{sid}?k={key}")
    a.wait_for_timeout(9000)
    ok(a.evaluate("() => document.querySelectorAll('audio').length")>0, "participant hears the host before the end")
    a.get_by_label("Message the host").click(); a.wait_for_timeout(300)
    a.locator(".stagev__full").click(); a.wait_for_timeout(500)
    ok(a.evaluate("() => !!document.fullscreenElement || !!document.querySelector('.stagev--cover')"), "participant in full screen")
    # end
    h.locator(".btn--end").click(); h.get_by_role("button", name="End for everyone").click()
    a.wait_for_timeout(1200)
    for name,pg in [("laptop",a),("phone",ph),("3D",s3)]:
        ok(pg.locator(".endnote").is_visible(), f"{name}: notice 'Meeting ended by …' shows")
        ok(pg.locator(".ended").is_visible(), f"{name}: end card shows")
    ok("Shahnawaz" in a.locator(".endnote").inner_text(), "notice names the host")
    ok(not a.evaluate("() => !!document.fullscreenElement") and a.locator(".stagev--cover").count()==0, "full screen closes for the end card")
    a.screenshot(path=f"{D}/laptop.png"); ph.screenshot(path=f"{D}/phone.png"); h.screenshot(path=f"{D}/host.png"); s3.screenshot(path=f"{D}/3d.png")
    a.wait_for_timeout(3500)
    ok(a.evaluate("() => document.querySelectorAll('audio').length")==0, "participant's audio stops")
    ok(h.evaluate("() => document.querySelectorAll('audio').length")==0 and h.locator(".micbtn").count()==0 or "On air" not in (h.locator(".micbtn").inner_text() if h.locator(".micbtn").count() else ""), "host's microphone stops")
    tv.wait_for_timeout(500); ok(tv.locator(".ended").is_visible(), "room screen shows the end"); tv.screenshot(path=f"{D}/tv.png")
    a.wait_for_timeout(4000)
    ok(a.locator(".ended").is_visible() and a.locator(".veil__card h2", has_text="Couldn't join").count()==0, "still 'ended' a while later (no connection errors)")
    ok(not a.locator(".endnote").is_visible(), "notice hides after a few seconds")
    ok(h.locator(".ended", has_text="Start a new meeting").count()==1, "host can start a new meeting")
    # reload after the end
    ph.reload(); ph.wait_for_timeout(3000)
    ok("has ended" in ph.locator(".ended h2").inner_text(), "reopening the link shows 'This meeting has ended'")
    ph.screenshot(path=f"{D}/phone-reload.png")
    a.locator(".ended button", has_text="Back to home").click(); a.wait_for_timeout(800); ok(a.url.rstrip("/")==BASE, "Back to home")
    print("errors:", errs); print("FAILED:", fails)
