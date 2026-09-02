"""Generate whattONE app icon for macOS (.icns) and Windows-compatible (.png)"""
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Installing Pillow...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image, ImageDraw, ImageFont


def create_icon(size=1024):
    """Create a whattONE icon"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Rounded rectangle background - green gradient
    margin = int(size * 0.05)
    radius = int(size * 0.18)
    
    # Draw rounded rect with gradient effect
    for i in range(size - 2 * margin):
        progress = i / (size - 2 * margin)
        r = int(7 + (37 - 7) * progress)
        g = int(94 + (211 - 94) * progress)
        b = int(84 + (102 - 84) * progress)
        color = (r, g, b, 255)
        y = margin + i
        draw.line([(margin, y), (size - margin, y)], fill=color)
    
    # Create mask for rounded corners
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=255
    )
    
    # Apply mask
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    result.paste(img, mask=mask)
    img = result
    draw = ImageDraw.Draw(img)
    
    # Draw chat bubble
    cx, cy = size // 2, int(size * 0.42)
    bw, bh = int(size * 0.50), int(size * 0.38)
    
    # Bubble body
    draw.rounded_rectangle(
        [cx - bw//2, cy - bh//2, cx + bw//2, cy + bh//2],
        radius=int(size * 0.08),
        fill=(255, 255, 255, 240)
    )
    
    # Bubble tail
    tail_points = [
        (cx - int(size * 0.05), cy + bh//2 - 2),
        (cx - int(size * 0.15), cy + bh//2 + int(size * 0.08)),
        (cx + int(size * 0.05), cy + bh//2 - 2),
    ]
    draw.polygon(tail_points, fill=(255, 255, 255, 240))
    
    # "W" letter in bubble
    try:
        font_w = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", int(size * 0.25))
    except:
        try:
            font_w = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", int(size * 0.25))
        except:
            font_w = ImageFont.load_default()
    
    draw.text((cx, cy - int(size * 0.02)), "W", fill=(7, 94, 84), font=font_w, anchor="mm")
    
    # "1" subscript circle
    c1x, c1y = cx + int(size * 0.18), cy - int(size * 0.12)
    c1r = int(size * 0.08)
    draw.ellipse([c1x - c1r, c1y - c1r, c1x + c1r, c1y + c1r], fill=(255, 82, 82))
    
    try:
        font_1 = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", int(size * 0.09))
    except:
        try:
            font_1 = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", int(size * 0.09))
        except:
            font_1 = ImageFont.load_default()
    
    draw.text((c1x, c1y), "1", fill=(255, 255, 255), font=font_1, anchor="mm")
    
    # "whattONE" text at bottom
    try:
        font_name = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", int(size * 0.09))
    except:
        try:
            font_name = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", int(size * 0.09))
        except:
            font_name = ImageFont.load_default()
    
    text_y = int(size * 0.78)
    draw.text((cx, text_y), "whattONE", fill=(255, 255, 255, 230), font=font_name, anchor="mm")
    
    return img


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("🎨 Generating whattONE icon...")
    icon = create_icon(1024)
    
    # Save PNG
    png_path = os.path.join(base_dir, "icon.png")
    icon.save(png_path, "PNG")
    print(f"  ✅ PNG: {png_path}")
    
    # Save sizes for .icns
    iconset_dir = os.path.join(base_dir, "whattONE.iconset")
    os.makedirs(iconset_dir, exist_ok=True)
    
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for s in sizes:
        resized = icon.resize((s, s), Image.LANCZOS)
        resized.save(os.path.join(iconset_dir, f"icon_{s}x{s}.png"), "PNG")
        if s <= 512:
            resized2x = icon.resize((s * 2, s * 2), Image.LANCZOS)
            resized2x.save(os.path.join(iconset_dir, f"icon_{s}x{s}@2x.png"), "PNG")
    
    # Try to create .icns on macOS
    icns_path = os.path.join(base_dir, "whattONE.app", "Contents", "Resources", "AppIcon.icns")
    if sys.platform == "darwin":
        os.system(f'iconutil -c icns "{iconset_dir}" -o "{icns_path}"')
        if os.path.exists(icns_path):
            print(f"  ✅ ICNS: {icns_path}")
        else:
            print("  ⚠️  iconutil failed, using PNG fallback")
    
    # Save ICO for Windows (multi-size)
    ico_path = os.path.join(base_dir, "whattone.ico")
    ico_sizes = [icon.resize((s, s), Image.LANCZOS) for s in [16, 32, 48, 64, 128, 256]]
    ico_sizes[0].save(ico_path, format='ICO', sizes=[(s, s) for s in [16, 32, 48, 64, 128, 256]], append_images=ico_sizes[1:])
    print(f"  ✅ ICO: {ico_path}")
    
    # Cleanup iconset
    import shutil
    shutil.rmtree(iconset_dir, ignore_errors=True)
    
    print("\n🎉 Done!")


if __name__ == "__main__":
    main()
