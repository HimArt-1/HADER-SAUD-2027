from PIL import Image
import os

source_image_path = "/Users/him.art/.gemini/antigravity/brain/fb3c0306-f88d-4328-abab-057bca7be9ec/uploaded_media_1769910996084.png"
output_dir = "/Users/him.art/Desktop/hader+whatsapp/public"

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

try:
    img = Image.open(source_image_path)
    
    # Generate favicon.ico (includes 16x16, 32x32, 48x48)
    img.save(os.path.join(output_dir, "favicon.ico"), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    print("Generated favicon.ico")

    # Generate logo192.png
    img_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    img_192.save(os.path.join(output_dir, "logo192.png"))
    print("Generated logo192.png")

    # Generate logo512.png
    img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    img_512.save(os.path.join(output_dir, "logo512.png"))
    print("Generated logo512.png")
    
    # Generate apple-touch-icon.png (usually 180x180)
    img_apple = img.resize((180, 180), Image.Resampling.LANCZOS)
    img_apple.save(os.path.join(output_dir, "apple-touch-icon.png"))
    print("Generated apple-touch-icon.png")

    # Also update the main logo if needed, but let's keep the user's uploaded one as the source of truth for icons
    # The existing code uses /images/hader-logo.png for the UI. The user asked to make *this image* the icon for the app systems.
    # It might be good to update the main UI logo too? "انشئ هذي الصوره ايقونة التطبيق في كل الانظمه" implies app icon.
    # Usually app icon != internal UI logo (which might be wide text).
    # Looking at the uploaded image, it is the logo with text "Hader" in Arabic and English maybe?
    # I will leave the UI logo alone for now unless requested, as "app icon" usually refers to the launcher/favicon.

except Exception as e:
    print(f"Error generating icons: {e}")
