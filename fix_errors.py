with open("services/cloudProvider.ts", "r") as f:
    c = f.read()

# Add supabaseStatus import if missing
if "supabaseStatus" not in c.split("import ")[1].split("\n")[0]:
    c = c.replace("import { supabase } from './supabase';", "import { supabase, supabaseStatus } from './supabase';")

# Fix payload.id -> call.id
c = c.replace("broadcastDismissalEvent('call_added', payload.id);", "broadcastDismissalEvent('call_added', call.id || '');")

with open("services/cloudProvider.ts", "w") as f:
    f.write(c)

with open("services/hybridProvider.ts", "r") as f:
    h = f.read()

# Fix payload.id
h = h.replace("syncable ? syncable.id : payload.id", "syncable.id")

with open("services/hybridProvider.ts", "w") as f:
    f.write(h)

print("Errors fixed.")
