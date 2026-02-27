
import os
import requests
import json
import sys

# Set stdout to UTF-8 to handle Hebrew characters
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Try to load .env.local manually
def load_env_local(path):
    if not os.path.exists(path):
        return
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, value = line.split('=', 1)
                os.environ[key] = value

load_env_local('.env.local')

supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
service_role_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not service_role_key:
    print("Missing Supabase environment variables.")
    exit(1)

headers = {
    "apikey": service_role_key,
    "Authorization": f"Bearer {service_role_key}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def update_services(old_names, new_name):
    print(f"Updating {old_names} to '{new_name}'...")
    updated_total = 0
    for old_name in old_names:
        # Supabase REST API update with filter
        url = f"{supabase_url}/rest/v1/purchases?service_id=eq.{old_name}"
        payload = {"service_id": new_name}
        response = requests.patch(url, headers=headers, json=payload)
        if response.status_code in [200, 201, 204]:
            print(f"  Successfully updated '{old_name}'")
        else:
            print(f"  Error updating '{old_name}': {response.status_code}")
            print(response.text)

# 1. Physical Tech Characterization to Engineering
update_services(["אפיון טכני פיזי"], "אפיון טכני - הנדסי")

# 2. Dreidel Printing to Prototype Production
update_services(["הדפסת סביבונים"], "ייצור אבטיפוס")

# 3. App Add-ons to Software Development
update_services(["תוספות לאפליקציה"], "פיתוח תוכנה ואפליקציות")

# 4. PRD to Technical Characterization
update_services(["PRD"], "אפיון טכני")

print("\nThird round of consolidation complete.")
