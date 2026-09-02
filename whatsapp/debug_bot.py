import os
import sys
from whatsapp_pro_tool import WhatsAppOffensiveTool
import logging

# Setup basic logging to stdout
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', stream=sys.stdout)

TARGET_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "contacts.csv")

def debug_run():
    print(f"--- STARTING DEBUG RUN ---")
    print(f"Current Directory: {os.getcwd()}")
    
    if not os.path.exists(TARGET_CSV):
        print(f"ERROR: CSV file not found at {TARGET_CSV}")
        return

    print("Initializing Bot Tool...")
    tool = WhatsAppOffensiveTool(TARGET_CSV)
    
    print("Launching Browser...")
    tool.init_browser()
    
    print("Checking Login...")
    if tool.check_login():
        print("Login Successful! Starting Mission...")
        # Run with short delays for debugging
        tool.run_mission(batch_size=1, min_delay=5, max_delay=10, long_break=10)
    else:
        print("Login Check Failed!")
        
    print("--- DEBUG RUN COMPLETE ---")
    # Keep browser open for a bit to see what happened
    import time
    time.sleep(10)
    if tool.driver:
        tool.driver.quit()

if __name__ == "__main__":
    debug_run()
