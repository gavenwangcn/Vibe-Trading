"""Compare localhost with the public IP. Run this on the server, not in the browser.

Example:
    python3 scripts/check_public_ip.py
    python3 scripts/check_public_ip.py --ip 156.254.6.224
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import time
import urllib.error
import urllib.request


def check(base: str, timeout: float) -> str:
    """Return a one-line result for health and session creation."""
    health = _call("GET", base + "/health", None, timeout)
    session = _call("POST", base + "/sessions", {"title": "你好"}, timeout)
    return f"health={health}  POST /sessions={session}"


def _call(method: str, url: str, body: dict | None, timeout: float) -> str:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("API_AUTH_KEY", "")
    if key:
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = time.perf_counter() - started
            return f"{resp.status} {elapsed:.2f}s"
    except urllib.error.HTTPError as exc:
        elapsed = time.perf_counter() - started
        return f"HTTP {exc.code} {elapsed:.2f}s"
    except Exception as exc:
        elapsed = time.perf_counter() - started
        return f"{type(exc).__name__} {elapsed:.2f}s ({exc})"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check whether the public IP reaches this service.")
    parser.add_argument("--ip", default="156.254.6.224")
    parser.add_argument("--port", type=int, default=8899)
    parser.add_argument("--timeout", type=float, default=8)
    args = parser.parse_args()

    targets = [
        ("本机 127.0.0.1", f"http://127.0.0.1:{args.port}"),
        ("公网 IP 端口 80", f"http://{args.ip}"),
        ("公网 IP 端口 8899", f"http://{args.ip}:{args.port}"),
    ]
    print(f"server hostname={socket.gethostname()} timeout={args.timeout}s", flush=True)
    results: list[tuple[str, str]] = []
    for label, base in targets:
        print(f"\n== {label}  {base}", flush=True)
        line = check(base, args.timeout)
        results.append((label, line))
        print(line, flush=True)

    local, port80, public = (line for _, line in results)
    reached = ("200" in public or "201" in public or "401" in public) and "Timeout" not in public
    local_ok = "200" in local and "Timeout" not in local
    print("\n结论:", flush=True)
    if not local_ok:
        print("本机 127.0.0.1:%s 都不通，先看容器是否在听这个端口。" % args.port, flush=True)
    elif reached and ("Timeout" in port80 or "timed out" in port80.lower()):
        print("80 端口不通，8899 通。不要用 http://%s/ ，要用 http://%s:%s/" % (args.ip, args.ip, args.port), flush=True)
    elif reached:
        print("公网 %s:%s 能进到后端，不是 IP 不通。" % (args.ip, args.port), flush=True)
    else:
        print("本机能访问，公网 %s:%s 不能。多半是防火墙或安全组没有放行。" % (args.ip, args.port), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
