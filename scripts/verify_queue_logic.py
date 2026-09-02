import requests
import os
import csv
import time
from dotenv import load_dotenv

# Load env to get API Key
load_dotenv('.env')

API_KEY = os.environ.get('WHATSAPP_API_KEY')
BASE_URL = "http://localhost:5001"

if not API_KEY:
    print("❌ Error: WHATSAPP_API_KEY not found in .env")
    exit(1)

print(f"🔑 Using API Key: {API_KEY[:6]}...")

# 1. Clear Queue First (to ensure clean slate)
print("\n🧹 1. Clearing Queue...")
headers = {'X-API-Key': API_KEY}
try:
    resp = requests.post(f"{BASE_URL}/clear", headers=headers)
    if resp.status_code == 200:
        print("   ✅ Queue cleared.")
    else:
        print(f"   ❌ Failed to clear queue: {resp.status_code} - {resp.text}")
except Exception as e:
    print(f"   ⚠️ Server might not be running: {e}")
    print("   Please start 'python3 whatsapp/server.py' in a separate terminal.")
    exit(1)

# 2. Add Test Item
print("\n📥 2. Sending Test Message...")
payload = [
    {
        "phone": "966500000000",
        "message": "Test Message verifies queue integrity 🚀",
        "student_name": "Test Student"
    }
]

resp = requests.post(f"{BASE_URL}/send?append=true", json=payload, headers=headers)
if resp.status_code == 200:
    print("   ✅ Request accepted by server.")
else:
    print(f"   ❌ Request failed: {resp.status_code} - {resp.text}")
    exit(1)

# 3. Verify CSV Content
print("\n📂 3. Verifying CSV Content...")
csv_path = "whatsapp/contacts.csv"
if os.path.exists(csv_path):
    with open(csv_path, 'r', encoding='utf-8') as f:
        content = f.read()
        print("   📄 CSV Content:")
        print(content)
        
        if "966500000000" in content and "Test Message verifies queue integrity 🚀" in content:
             print("\n🎉 SUCCESS: Data arrived in CSV correctly!")
        else:
             print("\n❌ FAILURE: Data sent but not found in CSV.")
else:
    print(f"\n❌ FAILURE: {csv_path} not found.")
