#!/usr/bin/env python3
"""Serve Satellite over HTTPS for Mac and phone preview.

This app is Next.js. The preview cert is created here, then Next serves it.
"""
# --- preview-ctl guard v3: begin ---
# Managed by ~/bin/preview-ctl.py. Three hazards this removes:
#   1. The launching terminal can go away while the server runs on. Writing an
#      access-log line to a dead pipe would raise mid-response and leave the
#      port open and silent. Make stdio unable to raise.
#   2. A browser or phone that walks away mid-response is normal, not an error.
#      Left alone it writes a traceback per disconnect into the log.
#   3. TLS on the listening socket puts the handshake inside accept() on the
#      main thread. One client that opens a socket and never sends a
#      ClientHello then stops the whole server: it accepts and answers
#      nothing. Hand the handshake to the worker thread, where the handler's
#      timeout can end it.
import socket as _pc_socket
import socketserver as _pc_ss
import ssl as _pc_ssl
import sys as _pc_sys


class _PcQuiet:
    def __init__(self, stream):
        self._stream = stream

    def write(self, data):
        try:
            return self._stream.write(data)
        except Exception:
            return len(data) if isinstance(data, (str, bytes)) else 0

    def flush(self):
        try:
            self._stream.flush()
        except Exception:
            pass

    def isatty(self):
        try:
            return self._stream.isatty()
        except Exception:
            return False

    def fileno(self):
        return self._stream.fileno()

    def __getattr__(self, name):
        return getattr(self._stream, name)


_pc_sys.stdout = _PcQuiet(_pc_sys.stdout)
_pc_sys.stderr = _PcQuiet(_pc_sys.stderr)

_PC_QUIET_ERRORS = (
    BrokenPipeError,
    ConnectionResetError,
    ConnectionAbortedError,
    TimeoutError,
    _pc_socket.timeout,
    _pc_ssl.SSLError,
)
_pc_handle_error = _pc_ss.BaseServer.handle_error


def _pc_quiet_handle_error(self, request, client_address):
    if isinstance(_pc_sys.exc_info()[1], _PC_QUIET_ERRORS):
        return
    return _pc_handle_error(self, request, client_address)


_pc_ss.BaseServer.handle_error = _pc_quiet_handle_error

_pc_wrap_socket = _pc_ssl.SSLContext.wrap_socket


def _pc_lazy_wrap(self, sock, server_side=False, do_handshake_on_connect=True,
                  *args, **kwargs):
    """Never shake hands on the thread that calls accept()."""
    if server_side:
        do_handshake_on_connect = False
    return _pc_wrap_socket(
        self, sock, server_side, do_handshake_on_connect, *args, **kwargs
    )


_pc_ssl.SSLContext.wrap_socket = _pc_lazy_wrap

# A deferred handshake runs on the first read, so the read needs a deadline.
if _pc_ss.StreamRequestHandler.timeout is None:
    _pc_ss.StreamRequestHandler.timeout = 20
# --- preview-ctl guard v3: end ---
from pathlib import Path
import os
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8909
CERT = ROOT / ".local-cert.pem"
KEY = ROOT / ".local-key.pem"
NODE = "/usr/local/bin/node"
NEXT_BIN = ROOT / "node_modules" / "next" / "dist" / "bin" / "next"


def _lan_ips():
    ips = []

    def add(ip):
        if (
            ip
            and ip not in ips
            and not ip.startswith("127.")
            and not ip.startswith("169.254.")
        ):
            ips.append(ip)

    for iface in ("en0", "en1", "en2", "bridge0"):
        try:
            ip = subprocess.check_output(
                ["ipconfig", "getifaddr", iface],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            add(ip)
        except Exception:
            pass
    return ips


def _local_hostnames():
    names = ["localhost"]
    try:
        n = subprocess.check_output(
            ["scutil", "--get", "LocalHostName"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        if n:
            names.append(n)
            names.append(n + ".local")
    except Exception:
        pass
    return names


def _cert_text():
    if not CERT.exists():
        return ""
    try:
        return subprocess.check_output(
            ["openssl", "x509", "-in", str(CERT), "-noout", "-text"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return ""


def _ensure_cert(lan_ips, hostnames):
    text = _cert_text()
    needed = list(hostnames) + ["127.0.0.1"] + list(lan_ips)
    missing = [n for n in needed if n not in text]
    if CERT.exists() and KEY.exists() and not missing:
        return
    dns_lines = ["DNS.%d = %s" % (i, n) for i, n in enumerate(hostnames, start=1)]
    ip_lines = ["IP.1 = 127.0.0.1"]
    for i, ip in enumerate(lan_ips, start=2):
        ip_lines.append("IP.%d = %s" % (i, ip))
    cfg = "\n".join(
        [
            "[req]",
            "distinguished_name = dn",
            "x509_extensions = v3_req",
            "prompt = no",
            "[dn]",
            "CN = localhost",
            "[v3_req]",
            "subjectAltName = @alt",
            "basicConstraints = CA:FALSE",
            "keyUsage = digitalSignature, keyEncipherment",
            "extendedKeyUsage = serverAuth",
            "[alt]",
            *dns_lines,
            *ip_lines,
            "",
        ]
    )
    with tempfile.NamedTemporaryFile("w", suffix=".cnf", delete=False) as f:
        f.write(cfg)
        cfg_path = f.name
    try:
        subprocess.check_call(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(KEY),
                "-out",
                str(CERT),
                "-days",
                "825",
                "-config",
                cfg_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    finally:
        Path(cfg_path).unlink(missing_ok=True)


def main():
    argv = [a for a in sys.argv[1:] if a]
    port = int(argv[0]) if argv else DEFAULT_PORT
    if not NEXT_BIN.exists() or not Path(NODE).exists():
        print("Next.js is not installed in this folder", file=sys.stderr)
        sys.exit(1)
    _ensure_cert(_lan_ips(), _local_hostnames())
    if not CERT.exists() or not KEY.exists():
        print("Could not create .local-cert.pem / .local-key.pem", file=sys.stderr)
        sys.exit(1)
    print("Satellite", flush=True)
    print("  Mac:    https://127.0.0.1:%s/" % port, flush=True)
    os.execv(
        NODE,
        [
            NODE,
            str(NEXT_BIN),
            "dev",
            "--hostname",
            "0.0.0.0",
            "--port",
            str(port),
            "--experimental-https",
            "--experimental-https-key",
            str(KEY),
            "--experimental-https-cert",
            str(CERT),
        ],
    )


if __name__ == "__main__":
    main()
