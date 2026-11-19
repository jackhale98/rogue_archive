#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
"""Sends keys / clicks / screenshots to an X display (XTest via ctypes).
usage: DISPLAY=:99 xkeys.py step...   step: key name (X keysym, e.g. Return,
space, Escape, Down, a), key@ms (wait after), shot:path, wait:ms,
click:x,y"""
import ctypes, subprocess, sys, time

x11 = ctypes.CDLL('libX11.so.6')
xtst = ctypes.CDLL('libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]
d = x11.XOpenDisplay(None)
if not d:
    sys.exit('no display')
shift = x11.XKeysymToKeycode(d, x11.XStringToKeysym(b'Shift_L'))


def key(name):
    upper = len(name) == 1 and name.isupper()
    sym = x11.XStringToKeysym(name.encode())
    code = x11.XKeysymToKeycode(d, sym)
    if upper:
        xtst.XTestFakeKeyEvent(d, shift, 1, 0)
    xtst.XTestFakeKeyEvent(d, code, 1, 0)
    x11.XFlush(d)
    time.sleep(0.05)
    xtst.XTestFakeKeyEvent(d, code, 0, 0)
    if upper:
        xtst.XTestFakeKeyEvent(d, shift, 0, 0)
    x11.XFlush(d)


for step in sys.argv[1:]:
    if step.startswith('shot:'):
        subprocess.run(['import', '-window', 'root', step[5:]], check=True)
        continue
    if step.startswith('wait:'):
        time.sleep(int(step[5:]) / 1000)
        continue
    name, _, ms = step.partition('@')
    if name.startswith('click:'):
        x, y = map(int, name[6:].split(','))
        xtst.XTestFakeMotionEvent(d, -1, x, y, 0)
        xtst.XTestFakeButtonEvent(d, 1, 1, 0)
        x11.XFlush(d)
        time.sleep(0.05)
        xtst.XTestFakeButtonEvent(d, 1, 0, 0)
        x11.XFlush(d)
    else:
        key(name)
    time.sleep(int(ms or 1500) / 1000)
