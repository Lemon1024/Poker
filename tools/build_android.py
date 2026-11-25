"""Build a locally signed, offline APK with JDK 17+ and Android SDK Build Tools 35.0.0."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from package_desktop import ASSETS, ROOT, STRATEGY_ASSETS


def execute(command, **kwargs):
    subprocess.run([str(x) for x in command], check=True, **kwargs)


def require(path):
    if not path.is_file():
        raise SystemExit(f"Missing tool or input: {path}")
    return path


def signing_key(keytool, work):
    folder = work / "development-signing"
    folder.mkdir(exist_ok=True)
    key, password = folder / "river-notes.p12", folder / "store-password"
    if key.exists() and not password.exists():
        raise SystemExit("Existing development key requires its original store-password file.")
    if not password.exists():
        with password.open("x", encoding="utf-8") as f:
            f.write(secrets.token_urlsafe(32))
    env = {**os.environ, "POKER_LOCAL_KEY_PASS": password.read_text(encoding="utf-8")}
    if not key.exists():
        execute([keytool, "-genkeypair", "-alias", "river-notes", "-storetype", "PKCS12",
                 "-keystore", key, "-storepass:env", "POKER_LOCAL_KEY_PASS", "-keyalg", "RSA",
                 "-keysize", "2048", "-validity", "3650", "-dname", "CN=River Notes Local Development"], env=env)
    return key, env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", default=os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT"))
    parser.add_argument("--jdk", default=os.environ.get("JAVA_HOME"))
    parser.add_argument("--edition", choices=("equity", "strategy"), default="equity")
    parser.add_argument("--version-code", type=int, help="APK version and output filename for a new release")
    options = parser.parse_args()
    if not options.sdk or not options.jdk:
        parser.error("supply --sdk and --jdk, or set ANDROID_HOME and JAVA_HOME")
    sdk, jdk = Path(options.sdk).resolve(), Path(options.jdk).resolve()
    tools = sdk / "build-tools" / "35.0.0"
    suffix = ".exe" if os.name == "nt" else ""
    aapt, align = [require(tools / (name + suffix)) for name in ("aapt2", "zipalign")]
    legacy_aapt = require(tools / ("aapt" + suffix))
    d8, signer = [require(tools / "lib" / (name + ".jar")) for name in ("d8", "apksigner")]
    java, javac, keytool = [require(jdk / "bin" / (name + suffix)) for name in ("java", "javac", "keytool")]
    platform = require(sdk / "platforms" / "android-35" / "android.jar")
    lambda_stubs = require(tools / "core-lambda-stubs.jar")
    manifest_source = require(ROOT / "android" / "AndroidManifest.xml")
    strings = require(ROOT / "android/res/values/strings.xml")
    sources = sorted((ROOT / "android" / "src").rglob("*.java"))
    if not sources:
        raise SystemExit("Missing Android Java sources")
    work = ROOT / ".work" / "android-build"
    work.mkdir(parents=True, exist_ok=True)
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    strategy = options.edition == "strategy"
    tree = ET.parse(manifest_source)
    ns = "http://schemas.android.com/apk/res/android"
    version = options.version_code if options.version_code is not None else int(tree.getroot().attrib[f"{{{ns}}}versionCode"])
    if version < 1:
        parser.error("--version-code must be positive")
    asset_paths = ASSETS + STRATEGY_ASSETS if strategy else ASSETS
    artifact = dist / f"poker-{options.edition}-android-v{version}.apk"
    with tempfile.TemporaryDirectory(dir=work) as folder:
        build = Path(folder)
        assets, classes, dex = [build / name for name in ("assets", "classes", "dex")]
        for directory in (assets, classes, dex):
            directory.mkdir()
        for rel in asset_paths:
            copy = assets / rel
            copy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(require(ROOT / rel), copy)
        unsigned = build / "unsigned.apk"
        manifest = build / "AndroidManifest.xml"
        ET.register_namespace("android", ns)
        tree.getroot().set(f"{{{ns}}}versionCode", str(version))
        tree.getroot().set(f"{{{ns}}}versionName", f"{version}.0")
        tree.write(manifest, encoding="utf-8", xml_declaration=True)
        resources = build / "resources.zip"
        execute([aapt, "compile", "--dir", strings.parent.parent, "-o", resources])
        execute([aapt, "link", "--debug-mode", "-o", unsigned, "-I", platform, "--manifest", manifest, "-A", assets,
                 "--min-sdk-version", "28", "--target-sdk-version", "35", resources])
        execute([javac, "-encoding", "UTF-8", "-source", "8", "-target", "8",
                 "-bootclasspath", os.pathsep.join(map(str, (lambda_stubs, platform))), "-d", classes, *sources])
        class_jar = build / "classes.jar"
        with ZipFile(class_jar, "w", ZIP_DEFLATED) as archive:
            for entry in classes.rglob("*.class"):
                archive.write(entry, entry.relative_to(classes).as_posix())
        execute([java, "-cp", d8, "com.android.tools.r8.D8", "--lib", platform,
                 "--min-api", "28", "--output", dex, class_jar])
        with ZipFile(unsigned, "a") as archive:
            archive.write(require(dex / "classes.dex"), "classes.dex", compress_type=ZIP_STORED)
        aligned = build / "aligned.apk"
        execute([align, "-f", "4", unsigned, aligned])
        key, env = signing_key(keytool, work)
        signed = build / "signed.apk"
        execute([java, "-jar", signer, "sign", "--ks", key, "--ks-key-alias", "river-notes",
                 "--ks-pass", "env:POKER_LOCAL_KEY_PASS", "--v4-signing-enabled", "false",
                 "--out", signed, aligned], env=env)
        verification = subprocess.check_output([str(java), "-jar", str(signer), "verify", "--verbose", "--print-certs",
                                                str(signed)], encoding="utf-8")
        print(verification, end="")
        certificate_prefix = "Signer #1 certificate SHA-256 digest: "
        cert_sha256 = next(line.removeprefix(certificate_prefix) for line in verification.splitlines()
                           if line.startswith(certificate_prefix))
        execute([align, "-c", "4", signed])
        badging = subprocess.check_output([str(aapt), "dump", "badging", str(signed)], encoding="utf-8")
        for item in ("name='org.rivernotes.poker'", f"versionCode='{version}'", f"versionName='{version}.0'"):
            if item not in badging.splitlines()[0]:
                raise SystemExit(f"APK package/version mismatch: {item}")
        for output in (badging, subprocess.check_output([str(legacy_aapt), "dump", "badging", str(signed)], encoding="utf-8")):
            if "application-label:'GTO训练营'" not in output.splitlines() or not any(
                    line.startswith("launchable-activity:") and "label='GTO训练营'" in line for line in output.splitlines()):
                raise SystemExit("APK application or launcher label mismatch")
        with ZipFile(signed) as apk:
            archive_assets = {name.removeprefix("assets/") for name in apk.namelist() if name.startswith("assets/")}
            if archive_assets != set(asset_paths):
                raise SystemExit("Unexpected APK assets")
            for rel in asset_paths:
                if apk.read("assets/" + rel) != (ROOT / rel).read_bytes():
                    raise SystemExit(f"APK asset mismatch: {rel}")
        signed.replace(artifact)
    evidence = {"apk": artifact.name, "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                "build_tools": "35.0.0", "android_api": 35, "min_api": 28,
                "signature_verified": True, "signer_certificate_sha256": cert_sha256, "zip_alignment_verified": True,
                "edition": options.edition, "package": "org.rivernotes.poker", "label": "GTO训练营",
                "version_code": version,
                "sources": {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                            for path in [Path(__file__).resolve(), ROOT / "tools/package_desktop.py", manifest_source, strings, *sources]},
                "assets": {rel: hashlib.sha256((ROOT / rel).read_bytes()).hexdigest() for rel in asset_paths},
                "device_status": "See independent emulator report"}
    report_name = f"android-build-{options.edition}-v{version}.json"
    (ROOT / "reports").mkdir(exist_ok=True)
    (ROOT / "reports" / report_name).write_text(json.dumps(evidence, indent=2)+"\n", encoding="utf-8")
    print(f"{artifact.name}   SHA-256 {evidence['sha256']}")


if __name__ == "__main__":
    main()
