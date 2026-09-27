"""Debug APK UI regression using the real offline Android routing engine.

Usage: python tools/validation/validate_auto_routes.py --serial SERIAL --output .sim-out
No Room writes, BLE changes, location spoofing, or app data resets.
"""
import argparse
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--adb", default="adb")
parser.add_argument("--serial", required=True)
parser.add_argument("--output", type=Path, default=Path(".sim-out"))
parser.add_argument("--restart-process", action="store_true", help="Restart the app process before testing; preserves stored app data")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
prefix = re.sub(r"[^a-zA-Z0-9_-]", "_", args.serial)
component = "com.resilientgeo.mesh/.debug.RouteValidationActivity"
results = []


def adb(*parts):
    completed = subprocess.run([args.adb, "-s", args.serial, *parts],
                               capture_output=True, timeout=40)
    if completed.returncode:
        raise RuntimeError(f"ADB {parts}: {completed.stderr.decode('utf-8', errors='replace')} "
                           f"{completed.stdout.decode('utf-8', errors='replace')}")
    return completed.stdout


def snapshot():
    adb("shell", "uiautomator", "dump", "/sdcard/route-validation-window.xml")
    content = adb("shell", "cat", "/sdcard/route-validation-window.xml")
    root = ET.fromstring(content)
    nodes = [node for node in root.iter("node")
             if node.get("package") == "com.resilientgeo.mesh"]
    return content, nodes


def label(node):
    return node.get("content-desc") or node.get("text") or ""


def tap(text):
    _, nodes = snapshot()
    matches = [node for node in nodes if text in label(node)]
    # Android's accessibility XML omits IconButton tooltip properties. Locate
    # the close button in the same header row when its tooltip isn't exposed.
    if not matches and text == "關閉路線":
        header = next(node for node in nodes if label(node) == "逃生路線")
        left, top, right, bottom = map(int, re.findall(r"\d+", header.get("bounds")))
        for node in nodes:
            if node.get("clickable") != "true" or label(node):
                continue
            x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
            if top - 30 <= (y1 + y2) // 2 <= bottom + 30 and (x1 + x2) // 2 > (left + right) // 2:
                matches.append(node)
        matches.sort(key=lambda node: int(re.findall(r"\d+", node.get("bounds"))[0]), reverse=True)
    assert matches, f"Missing control: {text}"
    node = next((node for node in matches if node.get("clickable") == "true"), matches[-1])
    left, top, right, bottom = map(int, re.findall(r"\d+", node.get("bounds")))
    adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))


def check(name, destination=None, calls=None, notice=None):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        content, nodes = snapshot()
        labels = [label(node) for node in nodes]
        if (destination is None or any(f"目的地：測試避難所 {destination}" in item for item in labels)) and \
                (calls is None or f"計算次數：{calls}" in labels) and \
                (notice is None or any(notice in item for item in labels)):
            (args.output / f"{prefix}-auto-route-{name}.xml").write_bytes(content)
            (args.output / f"{prefix}-auto-route-{name}.png").write_bytes(adb("exec-out", "screencap", "-p"))
            results.append({"step": name, "destination": destination, "calls": calls, "notice": notice})
            print(json.dumps(results[-1], ensure_ascii=True), flush=True)
            return
        time.sleep(0.5)
    raise AssertionError(f"{name}: expected destination={destination}, calls={calls}, notice={notice}; got {labels}")


adb("shell", "cmd", "statusbar", "collapse")
adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
if args.restart_process:
    adb("shell", "am", "force-stop", "com.resilientgeo.mesh")
adb("shell", "am", "start", "-f", "0x04000000", "-n", component)
check("loaded", calls=0)
time.sleep(2)
tap("推薦最近避難所")
time.sleep(1)
_, initial_nodes = snapshot()
if any(label(node) == "計算次數：0" for node in initial_nodes) and not any(label(node) == "逃生路線" for node in initial_nodes):
    # Initial map aggregation can move the action between the XML dump and
    # input injection. Retry only when no request or route sheet has started.
    tap("推薦最近避難所")
check("baseline", "B", 2)
tap("額滿測試")
check("full", "A", 4, "已自動重新規劃")
tap("開放測試")
check("open", "B", 6, "已自動重新規劃")
tap("連續更新測試")
check("burst", "A", 8, "已自動重新規劃")
tap("暫停重算")
tap("開放測試")
time.sleep(1)
check("paused", calls=8, notice="正在自動重新規劃")
tap("恢復重算")
check("resumed", "B", 10, "已自動重新規劃")
tap("到期測試")
check("expiry-start", "A", 12, "已自動重新規劃")
check("expiry-finished", "B", 14, "事件到期，已自動重新規劃")
tap("關閉路線")
tap("額滿測試")
time.sleep(1)
check("closed", calls=14)
_, closed_nodes = snapshot()
assert not any("逃生路線" == label(node) for node in closed_nodes), "Closed route reopened"
tap("推薦最近避難所")
check("reopened", "A", 16)
tap("到期測試")
check("background-start", "A", 18)
adb("shell", "input", "keyevent", "KEYCODE_HOME")
time.sleep(13)
adb("shell", "am", "start", "-f", "0x24000000", "-n", component)
check("background-resumed", "B", 20, "事件到期，已自動重新規劃")
adb("shell", "input", "keyevent", "KEYCODE_BACK")
(args.output / f"{prefix}-auto-route-result.json").write_text(
    json.dumps({"serial": args.serial, "passed": True, "steps": results}, ensure_ascii=False, indent=2), encoding="utf-8")
print("PASS", flush=True)
