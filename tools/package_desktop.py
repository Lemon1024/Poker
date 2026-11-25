"""Build the self-contained desktop download from the same files used in the browser."""
import hashlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ("index.html", "equity.html", "web/style.css", "web/camp.css", "web/home.js",
          "web/equity.js", "web/runner.js", "web/app.js")
ASSETS += tuple("preflop/" + name for name in ("index.html", "style.css", "ranges.js", "advice.js", "ui.js"))
ASSETS += tuple("training/" + name for name in ("index.html", "style.css", "session.js", "ui.js"))
STRATEGY_ASSETS = tuple("strategy/" + name for name in (
    "index.html", "style.css", "ui.js", "runner.js", "solver.js", "evaluate.js", "insights.js"))


def main():
    files = {name: (ROOT / name).read_bytes() for name in ASSETS + STRATEGY_ASSETS}
    destination = ROOT / "dist" / "gto-training-camp-desktop-v6.zip"
    destination.parent.mkdir(exist_ok=True)
    temporary = destination.with_suffix(".zip.tmp")
    with ZipFile(temporary, "w") as bundle:
        for name, data in files.items():
            entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            bundle.writestr(entry, data, compress_type=ZIP_DEFLATED)
    with ZipFile(temporary) as bundle:
        for name, data in files.items():
            if bundle.read(name) != data:
                raise ValueError(f"Archive verification failed for {name}")
    temporary.replace(destination)
    print(f"{destination.name}   SHA-256 {hashlib.sha256(destination.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
