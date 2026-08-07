import os
import zipfile

src_dir = r"c:\Users\Diya Malvia\Desktop\AI-VIDEO-EDITOR\AI-VIDEO-EDITOR"
dst_zip = r"C:\Users\Diya Malvia\Desktop\AI-VIDEO-EDITOR.zip"

excluded_dirs = {
    'node_modules', 'venv', '.venv', '.git', '__pycache__', 
    'dist', 'build', '.idea', '.vscode', 'export_output', 'tmp_exports'
}

excluded_extensions = {'.pth', '.bin', '.mp4', '.mov', '.avi', '.mkv', '.zip'}

if os.path.exists(dst_zip):
    try:
        os.remove(dst_zip)
    except Exception:
        dst_zip = r"C:\Users\Diya Malvia\Desktop\JAMIN24_FINAL.zip"
        if os.path.exists(dst_zip):
            try:
                os.remove(dst_zip)
            except Exception:
                pass

print("Compressing project into lightweight ZIP...")
with zipfile.ZipFile(dst_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src_dir):
        # Exclude directories
        dirs[:] = [d for d in dirs if d not in excluded_dirs]
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in excluded_extensions:
                continue
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, src_dir)
            z.write(full_path, rel_path)

size_mb = os.path.getsize(dst_zip) / (1024 * 1024)
print(f"SUCCESS: Created {dst_zip}")
print(f"Final Zip Size: {size_mb:.2f} MB")
