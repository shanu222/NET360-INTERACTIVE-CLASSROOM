# Clicks every control as a host and a participant and checks each one works.
# Needs a local server (npm start) and Playwright for Python:  python3 scripts/ui-audit.py [3d]
import json, sys, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
BASE="http://localhost:4000"; import tempfile; D=tempfile.gettempdir()
THREE = len(sys.argv)>1 and sys.argv[1]=="3d"
A=["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] if THREE else ["--no-sandbox","--disable-3d-apis"]
fails=[]; errs=[]
def ok(c, what):
    print(("✓ " if c else "✗ ")+what)
    if not c: fails.append(what)
def strokes(pg): return pg.evaluate("() => { const s=window.__board.state; return s.order.map(id=>s.strokes[id]).filter(x=>!x.hidden).map(x=>({t:x.st.tool,c:x.st.c,w:x.st.w,pg:x.pg})) }")
with sync_playwright() as p:
    b=p.chromium.launch(args=A)
    ctx=b.new_context(viewport={"width":1440,"height":900}, accept_downloads=True); ctx.grant_permissions(["clipboard-read","clipboard-write"], origin=BASE)
    h=ctx.new_page(); h.on("pageerror",lambda e: errs.append("host "+str(e)))
    h.add_init_script("localStorage.setItem('n360.penIntro','1'); window.showSaveFilePicker=undefined;")
    h.goto(BASE+"/?create"); h.wait_for_timeout(1500)
    h.get_by_label("Your name").fill("Shahnawaz"); h.get_by_role("button", name="Continue").click(); h.wait_for_timeout(500)
    h.get_by_role("radio", name="Class").click()
    ok(h.get_by_role("button", name="Start class").is_disabled(), "Start waits for a class name")
    h.get_by_placeholder("Type a class name").fill("Physics 101"); h.get_by_role("button", name="Start class").click()
    h.wait_for_url("**/host/**"); h.wait_for_timeout(9000 if THREE else 2500)
    if THREE:
        ok(h.locator(".stage3d--teacher").count()==1, "host opens in the 3D room")
    # where to draw
    def area():
        sel = ".room3d__board--write" if THREE and h.locator(".room3d__board--write").count() else ".stagev__pane .slate"
        return h.locator(sel).first.bounding_box()
    def draw(dx=0, dy=0, n=14):
        bb=area(); x0=bb["x"]+bb["width"]*0.25+dx; y0=bb["y"]+bb["height"]*0.3+dy
        h.mouse.move(x0,y0); h.mouse.down()
        for k in range(n): h.mouse.move(x0+k*12, y0+(k%4)*9)
        h.mouse.up(); h.wait_for_timeout(250)
    tools=h.locator(".dock")
    draw(); s=strokes(h); ok(len(s)==1 and s[0]["t"]=="pen", "pen draws")
    tools.get_by_label("Highlighter").click(); draw(0,40); ok(strokes(h)[-1]["t"]=="highlighter", "highlighter draws")
    for shape in ["line","arrow","rect","circle"]:
        tools.get_by_label("Shapes").click(); h.wait_for_timeout(150)
        fly=h.locator(".dock__flyout"); ok(fly.is_visible(), f"shapes menu opens ({shape})")
        fly.get_by_label(shape).click(); h.wait_for_timeout(150)
        ok(h.locator(".dock__flyout").count()==0, f"shapes menu closes after picking {shape}")
        draw(0, 80+20*["line","arrow","rect","circle"].index(shape), 8); ok(strokes(h)[-1]["t"]==shape, f"{shape} draws")
    tools.get_by_label("Pen").click()
    sw=h.locator(".dock__swatch"); sw.nth(2).click(); draw(0,-40); c2=strokes(h)[-1]["c"]; ok(c2 != strokes(h)[0]["c"], "colour changes")
    wbtn=h.locator(".dock__width"); wbtn.nth(2).click(); draw(0,-60); ok(strokes(h)[-1]["w"] > strokes(h)[0]["w"], "line width changes")
    n=len(strokes(h)); tools.get_by_label("Undo").click(); h.wait_for_timeout(200); ok(len(strokes(h))==n-1, "undo")
    tools.get_by_label("Redo").click(); h.wait_for_timeout(200); ok(len(strokes(h))==n, "redo")
    tools.get_by_label("Eraser").click(); bb=area()
    first=None
    # erase over the first pen stroke
    x0=bb["x"]+bb["width"]*0.25; y0=bb["y"]+bb["height"]*0.3
    h.mouse.move(x0-5,y0-20); h.mouse.down()
    for k in range(30): h.mouse.move(x0+k*6, y0+(k%2)*30-10)
    h.mouse.up(); h.wait_for_timeout(300); ok(len(strokes(h))<n, "eraser erases")
    tools.get_by_label("Clear page").click(); h.wait_for_timeout(300); ok(len(strokes(h))==0, "clear page")
    tools.get_by_label("Undo").click(); h.wait_for_timeout(300); ok(len(strokes(h))>0, "undo brings the page back")
    tools.get_by_label("Pen").click()
    # keyboard shortcut
    h.keyboard.press("h"); ok(h.locator(".dock").get_by_label("Highlighter").get_attribute("class").find("is-on")>=0, "H key picks the highlighter"); h.keyboard.press("p")
    # participant joins
    code=None
    h.locator(".rail__btn", has_text="Invite").click(); h.wait_for_timeout(300)
    code="".join(c for c in h.locator(".panel .code").inner_text() if c.isalnum()); ok(len(code)==6, "invite shows the code")
    h.get_by_role("button", name="Copy invite").click(); h.wait_for_timeout(300)
    clip=h.evaluate("navigator.clipboard.readText()"); ok(code in clip and "/join?code=" in clip, "copy invite puts link and code on the clipboard")
    h.locator(".panel .toggle input").click(); h.wait_for_timeout(1200); ok(not h.locator(".panel .toggle input").is_checked(), "room-screen join card toggles"); h.locator(".panel .toggle input").click()
    s=ctx.new_page(); s.on("pageerror",lambda e: errs.append("part "+str(e))); s.add_init_script("window.showSaveFilePicker=undefined;")
    s.goto(BASE+"/"); s.wait_for_timeout(800); s.get_by_label("Meeting or class code").fill(code); s.get_by_role("button", name="Join", exact=True).click(); s.wait_for_timeout(1200)
    s.get_by_label("Your name").fill("Ayesha Khan"); s.get_by_role("button", name="Join now").click(); s.wait_for_url("**/live/**"); s.wait_for_timeout(9000 if THREE else 2500)
    ok(len(strokes(s))==len(strokes(h)), "participant sees the same board")
    s.mouse.move(700,400); s.mouse.move(720,420); s.wait_for_timeout(200)
    s.get_by_role("button", name="Raise hand").click(); h.wait_for_timeout(800)
    h.locator(".rail__btn", has_text="People").click(); h.wait_for_timeout(600)
    ok("Ayesha" in h.locator(".hands").inner_text(), "host sees the raised hand")
    h.locator(".hands button", has_text="Done").click(); s.wait_for_timeout(800); ok(s.get_by_role("button", name="Raise hand").count()==1, "host lowers the hand")
    # chat both ways
    h.locator(".roster__btn").first.click(); h.wait_for_timeout(300)
    h.locator(".panel--chat textarea, .panel--chat input").first.fill("Hello Ayesha"); h.keyboard.press("Enter"); s.wait_for_timeout(1000)
    ok(s.locator(".chatpop, .drawer").count()>0 or "Hello Ayesha" in s.locator("body").inner_text(), "participant gets the host's message")
    s.get_by_label("Message the host").click(); s.wait_for_timeout(300)
    s.locator(".drawer textarea, .drawer input").first.fill("Thank you"); s.keyboard.press("Enter"); h.wait_for_timeout(1000)
    ok("Thank you" in h.locator(".panel--chat").inner_text(), "host gets the reply")
    s.get_by_label("Close").first.click()
    # present panel: slides, then modes
    h.locator(".rail__btn", has_text="Present").click(); h.wait_for_timeout(300)
    h.locator(".panel--present input[type=file]").set_input_files(__import__("os").path.join(__import__("os").path.dirname(__file__), "sample-slides.pdf"))
    h.wait_for_function("() => /Slide 1 \\/ 3/.test(document.body.innerText)", timeout=60000); h.wait_for_timeout(1500)
    ok(s.locator(".stagev--slides").count()==1, "participant sees slides large")
    nx=h.locator(".modebar [aria-label='Next slide']"); nx.click(); h.wait_for_timeout(500)
    ok("Slide 2 / 3" in h.locator(".modebar").inner_text(), "next slide")
    h.locator(".modebar [aria-label='Previous slide']").click(); h.wait_for_timeout(300); ok("Slide 1 / 3" in h.locator(".modebar").inner_text(), "previous slide")
    h.locator(".modebar__seg button", has_text="Side by side").click(); h.wait_for_timeout(1200); ok(h.locator(".stagev--split").count()==1 and s.locator(".stagev--split").count()==1, "side by side for both")
    h.locator(".modebar__seg button", has_text="Whiteboard").click(); h.wait_for_timeout(800); ok("Page" in h.locator(".modebar").inner_text(), "back to whiteboard")
    h.locator(".modebar [aria-label='New page']").click(); h.wait_for_timeout(400); ok("Page 2 / 2" in h.locator(".modebar").inner_text(), "new page")
    h.locator(".modebar [aria-label='Previous page']").click(); h.wait_for_timeout(400); ok("Page 1 / 2" in h.locator(".modebar").inner_text(), "previous page")
    h.locator(".modebar__seg button", has_text="Slides").click(); h.wait_for_timeout(500)
    # present: participant asks, host allows
    h.locator(".rail__btn", has_text="Present").click(); h.wait_for_timeout(300)
    s.get_by_label("Ask to present").click(); h.wait_for_timeout(800); ok(h.locator(".askpop").count()==1, "host sees the request to present")
    h.locator(".askpop button", has_text="Allow").click(); s.wait_for_timeout(800); ok(s.locator(".presbar").count()==1, "participant can present")
    s.locator(".presbar [aria-label='Next slide']").click(); h.wait_for_timeout(600); ok("Slide 2 / 3" in h.locator(".modebar").inner_text(), "presenter turns the slide")
    s.locator(".presbar button", has_text="Done").click(); s.wait_for_timeout(600); ok(s.locator(".presbar").count()==0, "presenter stops")
    # pen panel, screen
    h.locator(".rail__btn", has_text="Pen").click(); h.wait_for_timeout(300); ok(h.locator(".panel--pen").is_visible(), "pen panel opens")
    with ctx.expect_page() as popup: h.locator(".rail__btn", has_text="Screen").click()
    tv=popup.value; tv.wait_for_timeout(3000); ok("/board/" in tv.url, "Screen opens the room screen"); tv.close()
    # save notes from the bar
    with h.expect_download() as dl: h.locator(".modebar [aria-label='Save notes']").click()
    ok(dl.value.suggested_filename.endswith(".pdf"), "save notes (host)")
    # participant menu
    s.mouse.move(600,300); s.mouse.move(620,320)
    s.get_by_label("More").click(); s.wait_for_timeout(200)
    with s.expect_download() as dl2: s.locator(".menu button", has_text="Save notes").click()
    ok(dl2.value.suggested_filename.endswith(".pdf"), "save notes (participant)")
    s.get_by_label("Participants").click(); s.wait_for_timeout(300); ok("Shahnawaz" in s.locator(".mates__list").inner_text(), "participant list"); s.get_by_label("Participants").click()
    s.locator(".stagev__full").first.click(); s.wait_for_timeout(500); ok(s.evaluate("() => !!document.fullscreenElement || !!document.querySelector('.stagev--cover')"), "participant full screen")
    s.keyboard.press("Escape"); s.wait_for_timeout(300)
    if THREE:
        h.locator(".seg button", has_text="Walk").click(); h.wait_for_timeout(1500); ok(h.locator(".walkhint").count()==1, "walk mode")
        h.locator(".walkhint button").click(); h.wait_for_timeout(1000)
        h.locator(".seg button", has_text="Board").click(); h.wait_for_timeout(1500); ok(h.locator(".stagev").count()==1, "flat board view")
        h.locator(".seg button", has_text="Room").click(); h.wait_for_timeout(3000); ok(h.locator(".stage3d--teacher").count()==1, "back to the 3D room")
    # end
    h.locator(".btn--end").click(); h.get_by_role("button", name="Cancel").click(); ok(h.locator(".veil").count()==0, "cancel end")
    h.locator(".btn--end").click(); h.get_by_role("button", name="End for everyone").click(); s.wait_for_timeout(1500)
    ok("ended" in s.locator(".veil__card h2").inner_text(), "participant sees the end")
    h.screenshot(path=f"{D}/{'3d' if THREE else 'flat'}-end.png")
    print("\nFAILED:", fails); print("errors:", [e for e in errs])
