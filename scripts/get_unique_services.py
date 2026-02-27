
import os
import requests
import json
import sys

# Set stdout to UTF-8 to handle Hebrew characters
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Try to load .env.local manually if dotenv is not available
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

# Query unique service_id from purchases table
url = f"{supabase_url}/rest/v1/purchases?select=service_id"
headers = {
    "apikey": service_role_key,
    "Authorization": f"Bearer {service_role_key}",
    "Content-Type": "application/json"
}

response = requests.get(url, headers=headers)

if response.status_code != 200:
    print(f"Error fetching data: {response.status_code}")
    print(response.text)
    exit(1)

data = response.json()
counts = {}
for item in data:
    service = item.get('service_id')
    if service:
        service = service.strip()
        counts[service] = counts.get(service, 0) + 1
    else:
        counts['[Empty/Null]'] = counts.get('[Empty/Null]', 0) + 1

# Sort by count descending
sorted_counts = sorted(counts.items(), key=lambda x: x[1], reverse=True)

print("\nUnique Services and Counts:")
print("-" * 30)
for service, count in sorted_counts:
    print(f"{service}: {count}")
