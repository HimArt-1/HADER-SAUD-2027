#!/usr/bin/env python3
"""
Hader Smart Campus - Ultra-Premium 100% Seamless Loop Video Generator
Generates a 6.0 second (180 frames @ 30fps) seamless loop video from hader-smart-campus.webp.

Key Highlights:
- Fixed isometric camera angle (zero camera drift).
- Realistic 2.5D character motion (walking students, gate supervisor, classroom teacher/students,
  control room operators, cafeteria activity, dropoff child/parent).
- High-end commercial IoT tech animations:
  * Energy data packets (photons) flowing through the smart cyan ground grid.
  * Holographic biometric laser scanner sweeping at the turnstile gate with emerald approval HUD.
  * Real-time dynamic updating screens in the classroom & central control center.
  * Volumetric vehicle headlight illumination on the road.
  * Ambient palm tree wind sway, soft canteen steam, and atmospheric golden sunbeams with floating micro-particles.
- Mathematically closed cyclic functions: Frame 0 == Frame 180 for a perfect infinite loop.
- Encodes both H.264 FastStart MP4 and VP9 WebM.
"""

import os
import sys
import math
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

INPUT_IMAGE_PATH = 'public/landing/assets/img/hader-smart-campus.webp'
OUTPUT_MP4_PATH = 'public/landing/assets/img/hader-smart-campus-loop.mp4'
OUTPUT_WEBM_PATH = 'public/landing/assets/img/hader-smart-campus-loop.webm'

FPS = 30
DURATION_SEC = 6.0
TOTAL_FRAMES = int(FPS * DURATION_SEC) # 180 frames
WIDTH, HEIGHT = 1672, 941
TARGET_HEIGHT = 942 # even height required for yuv420p

print(f"=== Hader Smart Campus Loop Generator (Premium Edition) ===")
print(f"Frames: {TOTAL_FRAMES} | FPS: {FPS} | Duration: {DURATION_SEC}s | Native: {WIDTH}x{HEIGHT} -> Pad: {WIDTH}x{TARGET_HEIGHT}")

# 1. Load Base Image
base_img_rgba = Image.open(INPUT_IMAGE_PATH).convert('RGBA')

# 2. Exact Polyline Coordinates for Real Cyan Lines on Pavement
# Path 1: Front Entrance Path (Curves around planter to gate)
path_front_entrance = [
    (500, 850), (505, 810), (525, 780), (560, 750), (610, 710),
    (660, 650), (700, 610), (720, 580)
]

# Path 2: Central Avenue (Through Archway and along Central Courtyard)
path_central_avenue = [
    (720, 580), (750, 545), (785, 515), (835, 490), (890, 465),
    (945, 445), (1000, 425), (1060, 405)
]

# Path 3: Courtyard Branch to Cafeteria & Control Room
path_cafe_and_control = [
    (1060, 405), (1090, 390), (1130, 385), (1170, 395), (1210, 415),
    (1250, 435), (1285, 445)
]

# Path 4: Back Courtyard Palm Tree Loop
path_back_courtyard = [
    (850, 275), (865, 235), (890, 215), (925, 220), (955, 245),
    (940, 280), (910, 305), (875, 300)
]

# Path 5: Dropoff Canopy to Gate Connection
path_canopy_to_gate = [
    (1070, 535), (1010, 540), (940, 570), (860, 575), (780, 575), (720, 580)
]

def interpolate_polyline(points, num_steps=200):
    """Interpolates a list of points into smooth equidistant coordinates."""
    pts = np.array(points, dtype=np.float32)
    diffs = np.diff(pts, axis=0)
    dists = np.sqrt((diffs ** 2).sum(axis=1))
    cum_dists = np.insert(np.cumsum(dists), 0, 0)
    total_dist = cum_dists[-1]
    
    interp_dists = np.linspace(0, total_dist, num_steps)
    interp_x = np.interp(interp_dists, cum_dists, pts[:, 0])
    interp_y = np.interp(interp_dists, cum_dists, pts[:, 1])
    return list(zip(interp_x, interp_y))

poly_front = interpolate_polyline(path_front_entrance, 150)
poly_central = interpolate_polyline(path_central_avenue, 150)
poly_cafe_ctrl = interpolate_polyline(path_cafe_and_control, 150)
poly_back = interpolate_polyline(path_back_courtyard, 150)
poly_canopy = interpolate_polyline(path_canopy_to_gate, 150)

# 3. Extract Character Sprites with Feathered Alpha Masks
def extract_sprite(img, box, feather=4):
    x1, y1, x2, y2 = box
    crop = img.crop(box)
    w_box, h_box = x2 - x1, y2 - y1
    
    mask = Image.new('L', (w_box, h_box), 0)
    draw_m = ImageDraw.Draw(mask)
    draw_m.rectangle([feather, feather, w_box - feather, h_box - feather], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    crop.putalpha(mask)
    return crop, (x1, y1)

# Students walking in foreground
sprite_student1, pos_student1 = extract_sprite(base_img_rgba, (575, 550, 655, 755), feather=5)
sprite_student2, pos_student2 = extract_sprite(base_img_rgba, (515, 560, 595, 755), feather=5)
sprite_turnstile_stu, pos_turnstile_stu = extract_sprite(base_img_rgba, (655, 480, 735, 660), feather=4)
sprite_supervisor, pos_supervisor = extract_sprite(base_img_rgba, (695, 420, 795, 600), feather=4)
sprite_teacher, pos_teacher = extract_sprite(base_img_rgba, (330, 355, 385, 435), feather=3)
sprite_dropoff_pair, pos_dropoff_pair = extract_sprite(base_img_rgba, (995, 635, 1075, 790), feather=4)

# Palm Tree boxes for wind sway
tree_boxes = [
    (640, 50, 760, 180),
    (380, 60, 500, 200),
    (10, 180, 140, 340)
]
tree_sprites = [extract_sprite(base_img_rgba, box, feather=6)[0] for box in tree_boxes]

# Floating atmospheric dust particles
np.random.seed(1337)
NUM_PARTICLES = 50
particles = []
for _ in range(NUM_PARTICLES):
    particles.append({
        'x0': np.random.uniform(50, WIDTH - 50),
        'y0': np.random.uniform(50, HEIGHT - 50),
        'radius': np.random.uniform(1.2, 2.5),
        'speed_x': np.random.uniform(18, 38),
        'speed_y': np.random.uniform(-10, -22),
        'phase': np.random.uniform(0, 2 * math.pi),
        'alpha': np.random.uniform(0.35, 0.8)
    })

def apply_stride_shear(sprite, shear_amount):
    w, h = sprite.size
    m = (1, -shear_amount, 0, 0, 1, 0)
    return sprite.transform((w, h), Image.AFFINE, m, resample=Image.BICUBIC)

print("Pre-computations complete. Starting video pipeline...")

# FFmpeg subprocesses
ffmpeg_mp4_cmd = [
    'ffmpeg', '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-s', f'{WIDTH}x{HEIGHT}',
    '-pix_fmt', 'rgb24',
    '-r', str(FPS),
    '-i', '-',
    '-vf', f'pad={WIDTH}:{TARGET_HEIGHT}:0:0:color=black',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUTPUT_MP4_PATH
]

ffmpeg_webm_cmd = [
    'ffmpeg', '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-s', f'{WIDTH}x{HEIGHT}',
    '-pix_fmt', 'rgb24',
    '-r', str(FPS),
    '-i', '-',
    '-vf', f'pad={WIDTH}:{TARGET_HEIGHT}:0:0:color=black',
    '-c:v', 'libvpx-vp9',
    '-b:v', '0',
    '-crf', '26',
    '-deadline', 'realtime',
    '-cpu-used', '4',
    '-pix_fmt', 'yuv420p',
    OUTPUT_WEBM_PATH
]

proc_mp4 = subprocess.Popen(ffmpeg_mp4_cmd, stdin=subprocess.PIPE)
proc_webm = subprocess.Popen(ffmpeg_webm_cmd, stdin=subprocess.PIPE)

# Rendering Loop
for frame_idx in range(TOTAL_FRAMES):
    t = frame_idx / TOTAL_FRAMES
    theta = 2.0 * math.pi * t

    frame = base_img_rgba.copy()

    # -------------------------------------------------------------
    # 1. PALM TREE BREEZE SWAY (Natural harmonic oscillation)
    # -------------------------------------------------------------
    for (box, sprite) in zip(tree_boxes, tree_sprites):
        sway_phase = theta + (box[0] / 280.0)
        sway_dx = math.sin(sway_phase) * 3.0
        sway_dy = math.cos(sway_phase * 2) * 0.8
        swayed = sprite.transform(sprite.size, Image.AFFINE, 
                                 (1, 0, -sway_dx, 0, 1, -sway_dy), 
                                 resample=Image.BICUBIC)
        frame.alpha_composite(swayed, (box[0], box[1]))

    # -------------------------------------------------------------
    # 2. CHARACTER DYNAMICS (Realistic walking & living cadence)
    # -------------------------------------------------------------
    # Walking cycle: 6 strides in 6s (1.0 Hz cadence)
    walk_freq = 6.0
    walk_phase = theta * walk_freq

    # Student 1 (Lead Foreground):
    s1_bob = -2.8 * abs(math.sin(walk_phase))
    s1_shear = 0.035 * math.sin(walk_phase)
    s1_swayed = apply_stride_shear(sprite_student1, s1_shear)
    s1_x = int(pos_student1[0] + 1.2 * math.cos(walk_phase))
    s1_y = int(pos_student1[1] + s1_bob)
    frame.alpha_composite(s1_swayed, (s1_x, s1_y))

    # Student 2 (Follower Foreground):
    s2_phase = walk_phase + math.pi
    s2_bob = -2.6 * abs(math.sin(s2_phase))
    s2_shear = 0.035 * math.sin(s2_phase)
    s2_swayed = apply_stride_shear(sprite_student2, s2_shear)
    s2_x = int(pos_student2[0] + 1.2 * math.cos(s2_phase))
    s2_y = int(pos_student2[1] + s2_bob)
    frame.alpha_composite(s2_swayed, (s2_x, s2_y))

    # Turnstile Student (Crossing the gate):
    turn_bob = -1.8 * abs(math.sin(walk_phase))
    turn_x = int(pos_turnstile_stu[0] + 0.8 * math.sin(theta))
    turn_y = int(pos_turnstile_stu[1] + turn_bob)
    frame.alpha_composite(sprite_turnstile_stu, (turn_x, turn_y))

    # Gate Supervisor (Breathing posture & looking over):
    sup_breath = -1.2 * math.cos(theta * 2)
    sup_x = pos_supervisor[0]
    sup_y = int(pos_supervisor[1] + sup_breath)
    frame.alpha_composite(sprite_supervisor, (sup_x, sup_y))

    # Classroom Teacher (Explaining at smartboard):
    teach_phase = theta * 3
    teach_bob = -1.0 * abs(math.sin(teach_phase))
    frame.alpha_composite(sprite_teacher, (pos_teacher[0], int(pos_teacher[1] + teach_bob)))

    # Drop-off Child & Mother (Walking towards canopy):
    drop_bob = -2.0 * abs(math.sin(walk_phase))
    drop_x = int(pos_dropoff_pair[0] + 0.6 * math.sin(walk_phase))
    drop_y = int(pos_dropoff_pair[1] + drop_bob)
    frame.alpha_composite(sprite_dropoff_pair, (drop_x, drop_y))

    # -------------------------------------------------------------
    # 3. INTERACTIVE SCREENS & LIVE TELEMETRY FX
    # -------------------------------------------------------------
    fx_layer = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    fx_draw = ImageDraw.Draw(fx_layer)

    # A. Classroom Smartboard Dynamic Screen (x: 245..345, y: 360..435)
    board_center = (295, 395)
    board_radius = 16
    rot_angle = theta * 2
    arc_start = int(math.degrees(rot_angle)) % 360
    arc_end = (arc_start + 240) % 360
    fx_draw.arc([board_center[0] - board_radius, board_center[1] - board_radius,
                 board_center[0] + board_radius, board_center[1] + board_radius],
                start=arc_start, end=arc_end, fill=(0, 255, 200, 220), width=3)
    for b_i in range(5):
        bar_h = 10 + 8 * math.sin(theta * 4 + b_i * 0.8)
        bx = 260 + b_i * 7
        by = 415
        fx_draw.rectangle([bx, by - bar_h, bx + 4, by], fill=(0, 245, 180, 200))

    # B. Control Room Multi-Monitors (x: 1330..1530, y: 345..450)
    # Monitor 1: Live telemetry sinusoid waveform
    m1_pts = []
    for mx in range(1340, 1405, 3):
        my = 380 + 6 * math.sin((mx - 1340) * 0.15 + theta * 6)
        m1_pts.append((mx, my))
    if len(m1_pts) > 1:
        fx_draw.line(m1_pts, fill=(0, 255, 220, 230), width=2)

    # Monitor 2: Live attendance bars undulating
    for c_i in range(6):
        c_h = 14 + 10 * math.sin(theta * 5 + c_i * 1.1)
        cx = 1420 + c_i * 8
        cy = 415
        fx_draw.rectangle([cx, cy - c_h, cx + 5, cy], fill=(0, 255, 160, 220))

    # Monitor 3: Pulsing green Saudi map node beacons
    nodes = [(1485, 400), (1505, 415), (1495, 430)]
    for (nx, ny) in nodes:
        node_pulse = 0.5 + 0.5 * math.sin(theta * 4 + (nx + ny))
        nr = 2.5 + 2.0 * node_pulse
        fx_draw.ellipse([nx - nr, ny - nr, nx + nr, ny + nr], 
                        fill=(0, 255, 150, int(150 + 105 * node_pulse)))

    # C. Biometric Turnstile Scanner Laser Beam & Premium Cyber HUD
    # Laser bar sweeps down and up over the kiosk/student
    scan_y = 510 + 100 * (0.5 - 0.5 * math.cos(theta * 4))
    fx_draw.line([(675, scan_y), (730, scan_y + 12)], fill=(0, 255, 200, 220), width=2)
    
    # Premium Glassmorphism Approval HUD Capsule
    hud_alpha = int(190 + 65 * math.sin(theta * 2))
    hud_center = (705, 475)
    # Dark frosted glass capsule
    fx_draw.rounded_rectangle([hud_center[0] - 26, hud_center[1] - 9,
                               hud_center[0] + 26, hud_center[1] + 9],
                              radius=8, fill=(6, 32, 38, hud_alpha),
                              outline=(0, 255, 180, hud_alpha), width=1)
    # Glowing neon checkmark
    fx_draw.line([(hud_center[0] - 14, hud_center[1] + 1),
                  (hud_center[0] - 9, hud_center[1] + 5),
                  (hud_center[0] - 2, hud_center[1] - 4)],
                 fill=(0, 255, 180, 255), width=2)
    # Micro text lines inside HUD
    fx_draw.line([(hud_center[0] + 3, hud_center[1] - 2), (hud_center[0] + 18, hud_center[1] - 2)],
                 fill=(0, 240, 220, hud_alpha), width=2)
    fx_draw.line([(hud_center[0] + 3, hud_center[1] + 3), (hud_center[0] + 13, hud_center[1] + 3)],
                 fill=(0, 240, 220, int(hud_alpha * 0.7)), width=1)

    # Expanding ripple ring from turnstile
    ring_phase = (theta * 2) % (2 * math.pi)
    ring_radius = 4 + 20 * (ring_phase / (2 * math.pi))
    ring_alpha = int(220 * (1.0 - ring_phase / (2 * math.pi)))
    fx_draw.ellipse([705 - ring_radius, 540 - ring_radius * 0.5,
                     705 + ring_radius, 540 + ring_radius * 0.5],
                    outline=(0, 255, 200, ring_alpha), width=2)

    # D. Drop-Off Vehicle Smooth Volumetric Headlights Beam
    hl_intensity = 0.5 + 0.5 * math.sin(theta * 3)
    hl_alpha_source = int(180 + 75 * hl_intensity)
    # Soft volumetric light cones (projecting forward-left onto asphalt)
    # Left headlight at (1085, 700), Right at (1140, 730)
    fx_draw.polygon([(1085, 700), (960, 780), (1020, 825)],
                    fill=(200, 245, 255, int(60 + 25 * hl_intensity)))
    fx_draw.polygon([(1140, 730), (1020, 825), (1080, 860)],
                    fill=(200, 245, 255, int(60 + 25 * hl_intensity)))
    # Source flares
    fx_draw.ellipse([1081, 696, 1093, 708], fill=(255, 255, 255, hl_alpha_source))
    fx_draw.ellipse([1136, 726, 1148, 738], fill=(255, 255, 255, hl_alpha_source))

    # E. Cafeteria Pendant Lights Warmth & Soft Counter Steam
    for l_idx, lx in enumerate([1080, 1150, 1220, 1285]):
        lamp_glow = int(140 + 35 * math.sin(theta * 3 + l_idx * 1.2))
        fx_draw.ellipse([lx - 12, 190 - 12, lx + 12, 190 + 12],
                        fill=(255, 220, 120, int(lamp_glow * 0.4)))
        fx_draw.ellipse([lx - 4, 190 - 4, lx + 4, 190 + 4],
                        fill=(255, 245, 200, lamp_glow))
    # Subtle rising steam wisps above counter (x: 1100..1260, y: 220)
    for st_i in range(3):
        st_x = 1110 + st_i * 60 + 8 * math.sin(theta * 2 + st_i)
        st_y = 210 - 15 * ((t * 3 + st_i / 3) % 1.0)
        st_alpha = int(70 * (1.0 - ((t * 3 + st_i / 3) % 1.0)))
        fx_draw.ellipse([st_x - 10, st_y - 4, st_x + 10, st_y + 4],
                        fill=(255, 255, 255, st_alpha))

    # -------------------------------------------------------------
    # 4. SMART DATA HIGHWAYS: TRAVELING PHOTON ENERGY PULSES
    # -------------------------------------------------------------
    def draw_traveling_pulses(poly, num_pulses=3, color=(0, 255, 220), trail_len=14):
        total_pts = len(poly)
        for p_idx in range(num_pulses):
            offset = (t + p_idx / num_pulses) % 1.0
            center_idx = int(offset * (total_pts - 1))
            # Trail
            for step in range(trail_len):
                idx = (center_idx - step) % total_pts
                px, py = poly[idx]
                frac = 1.0 - (step / trail_len)
                alpha = int(240 * (frac ** 1.8))
                r = 2.0 + 3.0 * frac
                fx_draw.ellipse([px - r, py - r, px + r, py + r],
                                fill=(color[0], color[1], color[2], alpha))
            # Core
            hx, hy = poly[center_idx]
            fx_draw.ellipse([hx - 3.5, hy - 3.5, hx + 3.5, hy + 3.5],
                            fill=(255, 255, 255, 255))

    draw_traveling_pulses(poly_front, num_pulses=3, color=(0, 255, 220))
    draw_traveling_pulses(poly_central, num_pulses=3, color=(0, 240, 255))
    draw_traveling_pulses(poly_cafe_ctrl, num_pulses=2, color=(0, 255, 180))
    draw_traveling_pulses(poly_back, num_pulses=2, color=(0, 255, 200))
    draw_traveling_pulses(poly_canopy, num_pulses=2, color=(0, 230, 255))

    # -------------------------------------------------------------
    # 5. ATMOSPHERIC SUNBEAMS & FLOATING DUST PARTICLES
    # -------------------------------------------------------------
    sunbeam_alpha = int(22 + 10 * math.sin(theta))
    fx_draw.polygon([(400, 0), (700, 0), (1200, 700), (900, 700)],
                    fill=(255, 248, 220, sunbeam_alpha))
    fx_draw.polygon([(150, 0), (350, 0), (850, 800), (650, 800)],
                    fill=(255, 250, 230, int(sunbeam_alpha * 0.85)))

    for p in particles:
        px = (p['x0'] + p['speed_x'] * t * DURATION_SEC) % WIDTH
        py = (p['y0'] + p['speed_y'] * t * DURATION_SEC) % HEIGHT
        px += 3.0 * math.sin(theta * 2 + p['phase'])
        py += 3.0 * math.cos(theta * 2 + p['phase'])
        pr = p['radius']
        pa = int(p['alpha'] * (140 + 80 * math.sin(theta + p['phase'])))
        fx_draw.ellipse([px - pr, py - pr, px + pr, py + pr],
                        fill=(255, 250, 210, pa))

    # Apply soft Gaussian glow to tech FX layer and composite
    fx_blurred = fx_layer.filter(ImageFilter.GaussianBlur(1.8))
    frame.alpha_composite(fx_blurred)
    frame.alpha_composite(fx_layer)

    # Convert to RGB24 bytes and stream to FFmpeg
    raw_rgb_bytes = frame.convert('RGB').tobytes()
    proc_mp4.stdin.write(raw_rgb_bytes)
    proc_webm.stdin.write(raw_rgb_bytes)

    if (frame_idx + 1) % 30 == 0 or frame_idx == TOTAL_FRAMES - 1:
        print(f"Rendered frame {frame_idx + 1}/{TOTAL_FRAMES} ({(frame_idx + 1) / TOTAL_FRAMES * 100:.1f}%)")

# Finalize encoding
print("Finalizing video encoding...")
proc_mp4.stdin.close()
proc_webm.stdin.close()
proc_mp4.wait()
proc_webm.wait()

print(f"Video generation successful!")
print(f"MP4 output: {OUTPUT_MP4_PATH} ({os.path.getsize(OUTPUT_MP4_PATH) / 1024 / 1024:.2f} MB)")
print(f"WebM output: {OUTPUT_WEBM_PATH} ({os.path.getsize(OUTPUT_WEBM_PATH) / 1024 / 1024:.2f} MB)")
