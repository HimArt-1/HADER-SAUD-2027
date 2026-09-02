import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv('.env.local')
load_dotenv()

url = os.environ.get("VITE_SUPABASE_URL")
key = os.environ.get("VITE_SUPABASE_ANON_KEY")

if not url or not key:
    print("Error: Supabase credentials not found.")
    exit(1)

supabase: Client = create_client(url, key)

print("Checking for user 'adminHim'...")

try:
    response = supabase.table('users').select('*').eq('username', 'adminHim').execute()
    data = response.data

    if data:
        print("User 'adminHim' FOUND.")
        user = data[0]
        print(f"ID: {user.get('id')}")
        print(f"Role: {user.get('role')}")
        
        # Verify if it matches default hash
        default_hash = '100000:256d63775b1eb3d40bd505344fa78575:2af061074e754758390e577bd7acd96a0129f5c5a02d57fd219a2e119e13097d'
        if user.get('password') == default_hash:
             print("✅ Password hash matches the default (adminHim5000).")
        else:
             print("⚠️ Password hash DOES NOT match the default.")
             print("Resetting password to default...")
             supabase.table('users').update({'password': default_hash}).eq('username', 'adminHim').execute()
             print("✅ Password reset to 'adminHim5000'.")
             
        # Ensure role is site_admin
        if user.get('role') != 'site_admin':
             print("⚠️ Role is not site_admin. Updating...")
             supabase.table('users').update({'role': 'site_admin'}).eq('username', 'adminHim').execute()
             print("✅ Role updated to site_admin.")

    else:
        print("User 'adminHim' NOT FOUND.")
        print("Creating 'adminHim'...")
        default_hash = '100000:256d63775b1eb3d40bd505344fa78575:2af061074e754758390e577bd7acd96a0129f5c5a02d57fd219a2e119e13097d'
        new_user = {
            'username': 'adminHim',
            'name': 'مدير النظام',
            'role': 'site_admin',
            'password': default_hash,
            'is_active': True
        }
        supabase.table('users').insert(new_user).execute()
        print("✅ User 'adminHim' created with default credentials.")

except Exception as e:
    print(f"An error occurred: {e}")
