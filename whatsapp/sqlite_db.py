import sqlite3
import os
import logging
from typing import List, Dict, Any
from datetime import datetime

DB_FILE = os.path.join(os.path.dirname(__file__), "contacts.db")

# Maximum retry attempts for failed messages
MAX_RETRY_COUNT = 3


def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency
    return conn


def init_db():
    """Initialize the database schema, adding new columns if missing."""
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
                    status TEXT,
                    created_at TEXT,
                    sent_at TEXT,
                    retry_count INTEGER DEFAULT 0
                )
            ''')
            # Migrate: add new columns to existing databases (safe — ignores if exists)
            for col_def in [
                ("created_at", "TEXT"),
                ("sent_at", "TEXT"),
                ("retry_count", "INTEGER DEFAULT 0"),
            ]:
                try:
                    conn.execute(f'ALTER TABLE queue ADD COLUMN {col_def[0]} {col_def[1]}')
                except sqlite3.OperationalError:
                    pass  # Column already exists
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


def get_pending_with_retry() -> List[Dict[str, Any]]:
    """Get messages that are pending or failed but under max retry count."""
    try:
        with get_db() as conn:
            rows = conn.execute('''
                SELECT * FROM queue
                WHERE (status IS NULL OR status = '' OR status = 'pending'
                       OR (status = 'failed' AND (retry_count IS NULL OR retry_count < ?)))
                ORDER BY created_at ASC
            ''', (MAX_RETRY_COUNT,)).fetchall()
            return [dict(row) for row in rows]
    except Exception as e:
        logging.error(f"Error getting pending with retry: {e}")
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
        now = datetime.now().isoformat()
        with get_db() as conn:
            cursor = conn.cursor()
            for item in items:
                cursor.execute('''
                    INSERT OR REPLACE INTO queue 
                    (id, phone, message, attachment, student_name, status_label, status, created_at, sent_at, retry_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    item.get('id'),
                    item.get('phone'),
                    item.get('message'),
                    item.get('attachment'),
                    item.get('student_name', ''),
                    item.get('status_label', ''),
                    item.get('status', 'pending'),
                    item.get('created_at', now),
                    item.get('sent_at'),
                    item.get('retry_count', 0),
                ))
            return True
    except Exception as e:
        logging.error(f"Error appending to queue: {e}")
        return False


def overwrite_queue(items: List[Dict[str, Any]]) -> bool:
    try:
        now = datetime.now().isoformat()
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM queue')
            for item in items:
                cursor.execute('''
                    INSERT INTO queue 
                    (id, phone, message, attachment, student_name, status_label, status, created_at, sent_at, retry_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    item.get('id'),
                    item.get('phone'),
                    item.get('message'),
                    item.get('attachment'),
                    item.get('student_name', ''),
                    item.get('status_label', ''),
                    item.get('status', 'pending'),
                    item.get('created_at', now),
                    item.get('sent_at'),
                    item.get('retry_count', 0),
                ))
            return True
    except Exception as e:
        logging.error(f"Error overwriting queue: {e}")
        return False


def update_status(item_id: str, status: str) -> bool:
    """Update message status, with sent_at timestamp and retry_count tracking."""
    try:
        with get_db() as conn:
            if status == 'sent':
                cursor = conn.execute(
                    'UPDATE queue SET status = ?, sent_at = ? WHERE id = ?',
                    (status, datetime.now().isoformat(), item_id)
                )
            elif status == 'failed':
                cursor = conn.execute(
                    'UPDATE queue SET status = ?, retry_count = COALESCE(retry_count, 0) + 1 WHERE id = ?',
                    (status, item_id)
                )
            else:
                cursor = conn.execute(
                    'UPDATE queue SET status = ? WHERE id = ?',
                    (status, item_id)
                )
            return cursor.rowcount > 0
    except Exception as e:
        logging.error(f"Error updating status for {item_id}: {e}")
        return False


def get_stats() -> Dict[str, int]:
    """Return queue statistics."""
    try:
        with get_db() as conn:
            row = conn.execute('''
                SELECT
                    COUNT(*) as total,
                    COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) as sent,
                    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
                    COALESCE(SUM(CASE WHEN status = 'pending' OR status IS NULL OR status = '' THEN 1 ELSE 0 END), 0) as pending,
                    COALESCE(SUM(CASE WHEN status = 'skipped' OR status = 'invalid_phone' THEN 1 ELSE 0 END), 0) as skipped
                FROM queue
            ''').fetchone()
            if row:
                res = dict(row)
                return {k: (v if v is not None else 0) for k, v in res.items()}
            return {"total": 0, "sent": 0, "failed": 0, "pending": 0, "skipped": 0}
    except Exception as e:
        logging.error(f"Error getting stats: {e}")
        return {"total": 0, "sent": 0, "failed": 0, "pending": 0, "skipped": 0}


# ─── Auto-initialize on import ────────────────────────────────────
init_db()
