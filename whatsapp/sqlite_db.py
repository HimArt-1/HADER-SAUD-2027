import sqlite3
import os
import logging
from typing import List, Dict, Any

DB_FILE = os.path.join(os.path.dirname(__file__), "contacts.db")

def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    try:
        with get_db() as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS queue (
                    id TEXT PRIMARY KEY,
                    phone TEXT,
                    message TEXT,
                    attachment TEXT,
                    student_name TEXT,
                    status_label TEXT,
                    status TEXT
                )
            ''')
        logging.info("SQLite DB initialized")
    except Exception as e:
        logging.error(f"Error initializing SQLite DB: {e}")

def get_queue() -> List[Dict[str, Any]]:
    try:
        with get_db() as conn:
            rows = conn.execute('SELECT * FROM queue').fetchall()
            return [dict(row) for row in rows]
    except Exception as e:
        logging.error(f"Error getting queue: {e}")
        return []

def delete_item(item_id: str) -> bool:
    try:
        with get_db() as conn:
            cursor = conn.execute('DELETE FROM queue WHERE id = ?', (item_id,))
            return cursor.rowcount > 0
    except Exception as e:
        logging.error(f"Error deleting item {item_id}: {e}")
        return False

def clear_queue() -> bool:
    try:
        with get_db() as conn:
            conn.execute('DELETE FROM queue')
            return True
    except Exception as e:
        logging.error(f"Error clearing queue: {e}")
        return False

def append_to_queue(items: List[Dict[str, Any]]) -> bool:
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            for item in items:
                cursor.execute('''
                    INSERT OR REPLACE INTO queue 
                    (id, phone, message, attachment, student_name, status_label, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    item.get('id'),
                    item.get('phone'),
                    item.get('message'),
                    item.get('attachment'),
                    item.get('student_name', ''),
                    item.get('status_label', ''),
                    item.get('status', 'pending')
                ))
            return True
    except Exception as e:
        logging.error(f"Error appending to queue: {e}")
        return False

def overwrite_queue(items: List[Dict[str, Any]]) -> bool:
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM queue')
            for item in items:
                cursor.execute('''
                    INSERT INTO queue 
                    (id, phone, message, attachment, student_name, status_label, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    item.get('id'),
                    item.get('phone'),
                    item.get('message'),
                    item.get('attachment'),
                    item.get('student_name', ''),
                    item.get('status_label', ''),
                    item.get('status', 'pending')
                ))
            return True
    except Exception as e:
        logging.error(f"Error overwriting queue: {e}")
        return False

def update_status(item_id: str, status: str) -> bool:
    try:
        with get_db() as conn:
            cursor = conn.execute('UPDATE queue SET status = ? WHERE id = ?', (status, item_id))
            return cursor.rowcount > 0
    except Exception as e:
        logging.error(f"Error updating status for {item_id}: {e}")
        return False
