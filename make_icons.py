#!/usr/bin/env python3
"""Generate todo-app icons: pink gradient bg, white rounded card, list lines + checkmark."""
import struct, zlib, math

SS = 3  # supersample factor
S = 512
N = S * SS  # render size

def sd_segment(px, py, ax, ay, bx, by):
    apx, apy = px - ax, py - ay
    bpx, bpy = bx - ax, by - ay
    t = (apx * bpx + apy * bpy) / (bpx * bpx + bpy * bpy)
    t = max(0.0, min(1.0, t))
    dx, dy = apx - t * bpx, apy - t * bpy
    return math.hypot(dx, dy)

def sd_roundrect(px, py, cx, cy, hw, hh, r):
    qx, qy = abs(px - cx) - (hw - r), abs(py - cy) - (hh - r)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r

# colors (rgb 0-255)
BG_TOP = (255, 214, 236)   # soft pink
BG_BOT = (255, 158, 207)   # deeper pink
CARD = (255, 255, 255)
LINE = (186, 186, 201)     # soft gray
CHECK = (255, 95, 168)     # hot pink

def render():
    buf = bytearray(N * N * 3)
    # card geometry (in 512 space, scaled by SS)
    k = SS
    card_cx, card_cy = 256 * k, 256 * k
    card_hw, card_hh, card_r = 150 * k, 160 * k, 64 * k
    # list lines
    l1 = (170 * k, 205 * k, 342 * k, 205 * k, 13 * k)
    l2 = (170 * k, 249 * k, 300 * k, 249 * k, 13 * k)
    # checkmark
    c1 = (168 * k, 330 * k, 232 * k, 392 * k, 22 * k)
    c2 = (232 * k, 392 * k, 352 * k, 262 * k, 22 * k)

    for y in range(N):
        t = y / (N - 1)
        bg = (BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t,
              BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t,
              BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
        row = y * N * 3
        for x in range(N):
            px, py = x + 0.5, y + 0.5
            col = bg
            # card
            if sd_roundrect(px, py, card_cx, card_cy, card_hw, card_hh, card_r) < 0:
                col = CARD
                # lines
                if sd_segment(px, py, *l1[:4]) < l1[4]:
                    col = LINE
                if sd_segment(px, py, *l2[:4]) < l2[4]:
                    col = LINE
                # checkmark
                if sd_segment(px, py, *c1[:4]) < c1[4] or sd_segment(px, py, *c2[:4]) < c2[4]:
                    col = CHECK
            i = row + x * 3
            buf[i] = int(col[0]); buf[i+1] = int(col[1]); buf[i+2] = int(col[2])
    return buf

def downsample(buf, n, factor):
    """Average factor x factor blocks -> (n*n*3) bytes."""
    src = n * factor
    out = bytearray(n * n * 3)
    f2 = factor * factor
    for y in range(n):
        for x in range(n):
            r = g = b = 0
            for dy in range(factor):
                for dx in range(factor):
                    i = ((y * factor + dy) * src + (x * factor + dx)) * 3
                    r += buf[i]; g += buf[i+1]; b += buf[i+2]
            o = (y * n + x) * 3
            out[o] = r // f2; out[o+1] = g // f2; out[o+2] = b // f2
    return out

def write_png(path, data, n):
    def chunk(tag, payload):
        c = struct.pack('>I', len(payload)) + tag + payload
        return c + struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff)
    raw = bytearray()
    for y in range(n):
        raw.append(0)
        raw += data[y * n * 3:(y + 1) * n * 3]
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path)

big = render()
write_png('todo-app/icon-512x512.png', downsample(big, 512, SS), 512)
write_png('todo-app/icon-192x192.png', downsample(big, 192, 8), 192)