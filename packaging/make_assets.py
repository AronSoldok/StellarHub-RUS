"""Generates what the build needs: the app icon, the installer artwork, the version resource and the
code statistics shown in Settings > About (the installed app ships no .py files to count).

    python packaging/make_assets.py          (run from the repository root; build.ps1 does it for you)

Everything is drawn here from the same logo as the tray icon, so there are no binary files to keep in sync."""
import json
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
OUT = os.path.join(ROOT, "build", "assets")

from stellarhub import VERSION  # noqa: E402
from stellarhub.tray import make_icon_image  # noqa: E402

SPACE_TOP, SPACE_BOTTOM = (6, 10, 20), (14, 22, 42)  # #060A14 → a slightly lifted navy, as in the app
CORAL, ICE = (255, 122, 102), (158, 214, 255)


def icon():
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    big = make_icon_image(256)
    path = os.path.join(OUT, "StellarHub.ico")
    big.save(path, sizes=[(s, s) for s in sizes], bitmap_format="png")
    return path


def _space(w, h, seed):
    """Deep-space background: vertical gradient, a soft coral glow low on the left and a few hundred stars."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(SPACE_TOP, SPACE_BOTTOM))
        for x in range(w):
            px[x, y] = c
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = w * .55
    cx, cy = w * .5, h * .46
    gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=CORAL + (16,))
    glow = glow.filter(ImageFilter.GaussianBlur(w * .28))
    img = Image.alpha_composite(img.convert("RGBA"), glow)
    rnd = random.Random(seed)
    stars = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    for _ in range(int(w * h / 1300)):
        x, y = rnd.random() * w, rnd.random() * h
        s = rnd.choice((.6, .6, .8, 1, 1.3)) * w / 202
        a = rnd.randint(70, 230)
        col = ICE if rnd.random() < .25 else (255, 255, 255)
        sd.ellipse((x - s / 2, y - s / 2, x + s / 2, y + s / 2), fill=col + (a,))
    return Image.alpha_composite(img, stars)


def wizard_large(w, h):
    img = _space(w, h, seed=7)
    logo = make_icon_image(int(w * .62))
    halo = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    cx, cy, r = w / 2, h * .46, w * .3
    hd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=CORAL + (48,))
    halo = halo.filter(ImageFilter.GaussianBlur(w * .12))
    img = Image.alpha_composite(img, halo)
    img.alpha_composite(logo, (int(cx - logo.width / 2), int(cy - logo.height / 2)))
    return img.convert("RGB")


def wizard_small(size):
    return make_icon_image(size)


def version_file():
    nums = [int(x) for x in VERSION.split(".")] + [0] * 4
    v = tuple(nums[:4])
    text = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={v}, prodvers={v}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0,
                    date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'Esteban Arosemena'),
      StringStruct('FileDescription', 'StellarHub'),
      StringStruct('FileVersion', '{VERSION}'),
      StringStruct('InternalName', 'StellarHub'),
      StringStruct('LegalCopyright', 'Copyright (C) Esteban Arosemena. Licensed under the GNU GPL v3.'),
      StringStruct('OriginalFilename', 'StellarHub.exe'),
      StringStruct('ProductName', 'StellarHub'),
      StringStruct('ProductVersion', '{VERSION}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""
    path = os.path.join(OUT, "version_info.txt")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def project_stats():
    langs = {".py": "Python", ".js": "JavaScript", ".css": "CSS", ".html": "HTML"}
    out = {}
    for dirpath, dirs, files in os.walk(os.path.join(ROOT, "stellarhub")):
        dirs[:] = [d for d in dirs if d not in ("vendor", "fonts", "__pycache__")]
        for f in files:
            lang = langs.get(os.path.splitext(f)[1].lower())
            if lang:
                out[lang] = out.get(lang, 0) + os.path.getsize(os.path.join(dirpath, f))
    with open(os.path.join(OUT, "project_stats.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh)


def main():
    os.makedirs(OUT, exist_ok=True)
    icon()
    # sizes from the Inno Setup help: the image area at 100, 125, 150, 175 and 250 % scaling
    for w, h in ((202, 386), (269, 515), (336, 643), (403, 772), (534, 1022)):
        wizard_large(w, h).save(os.path.join(OUT, f"wizard-{w}.png"), optimize=True)
    for s in (58, 77, 97, 116, 159):
        wizard_small(s).save(os.path.join(OUT, f"wizard-small-{s}.png"), optimize=True)
    version_file()
    project_stats()
    print("assets ->", OUT, f"(version {VERSION})")


if __name__ == "__main__":
    main()
