import os
import time
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv('.env.local')
load_dotenv()

url = os.environ.get("VITE_SUPABASE_URL")
key = os.environ.get("VITE_SUPABASE_ANON_KEY")

if not url or not key:
    print("❌ Error: Supabase credentials not found.")
    exit(1)

supabase: Client = create_client(url, key)

print("🔍 Verifying Database Write Permissions (RLS)...")

# 1. Try to insert a dummy student
dummy_student = {
    "id": f"test_{int(time.time())}",
    "name": "طالب تجريبي",
    "class_name": "TestClass",
    "section": "A",
    "is_active": False
}

try:
    print("   Attempting to insert into 'students'...")
    response = supabase.table('students').insert(dummy_student).execute()
    print("   ✅ Insert successful! RLS seems permissive.")
    
    # Cleanup
    print("   Cleaning up test record...")
    supabase.table('students').delete().eq("id", dummy_student["id"]).execute()
    print("   ✅ Cleanup successful.")
    
    print("\n🎉 Permission Check PASSED. The application should work now.")

except Exception as e:
    print("\n❌ Permission Check FAILED.")
    print("   Error:", e)
    print("\n⚠️  You must run the 'fix_permissions.sql' script in Supabase Dashboard -> SQL Editor.")
