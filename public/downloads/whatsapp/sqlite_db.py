import sqlite3
import os
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

DB_DIR = os.environ.get('WHATSAPP_DATA_DIR', os.path.dirname(__file__))
DB_FILE = os.environ.get('WHATSAPP_DB_PATH') or os.path.join(DB_DIR, "contacts.db")

# Ensure directory exists
try:
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
except Exception:
    pass

# A failed row is attempted at most this many times in total: the first send plus one retry.
# Only rows that never reached the send button are marked 'failed', so a retry cannot deliver twice.
MAX_RETRY_COUNT = 2
# Retries cover glitches within the same sitting; yesterday's absence notice is not sent today.
RETRY_WINDOW_HOURS = 6


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
            conn.execute('''
                CREATE TABLE IF NOT EXISTS idempotency_records (
                    key TEXT PRIMARY KEY,
                    response TEXT,
                    created_at TEXT,
                    request_hash TEXT
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
            try:
                conn.execute('ALTER TABLE idempotency_records ADD COLUMN request_hash TEXT')
            except sqlite3.OperationalError:
                pass
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
    """
    Rows the engine should send now: fresh rows first, then failed rows that still have a retry.

    Rows mid-flight ('sending' / 'confirming') are left out — the running mission owns them, and a
    new mission recovers any leftovers through reset_stuck_sending first.
    """
    retry_since = (datetime.now() - timedelta(hours=RETRY_WINDOW_HOURS)).isoformat()
    try:
        with get_db() as conn:
            rows = conn.execute('''
                SELECT * FROM queue
                WHERE status IS NULL OR status = '' OR status = 'pending'
                   OR (status = 'failed' AND COALESCE(retry_count, 0) < ? AND created_at >= ?)
                ORDER BY CASE WHEN status = 'failed' THEN 1 ELSE 0 END, created_at ASC, rowid ASC
            ''', (MAX_RETRY_COUNT, retry_since)).fetchall()
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


def append_to_queue(items: List[Dict[str, Any]]) -> Optional[int]:
    """
    Add rows to the queue, ignoring any whose id is already there.
    Returns how many rows were new, or None when the queue could not be written.
    """
    try:
        now = datetime.now().isoformat()
        inserted = 0
        with get_db() as conn:
            cursor = conn.cursor()
            for item in items:
                cursor.execute('''
                    INSERT OR IGNORE INTO queue
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
                inserted += cursor.rowcount
            return inserted
    except Exception as e:
        logging.error(f"Error appending to queue: {e}")
        return None


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


def reset_stuck_sending() -> int:
    """
    Recover rows left mid-flight by a crashed or restarted mission.

    'sending' never reached the send button, so it is queued again. 'confirming' was pressed and may
    already be on the guardian's phone, so it waits for the operator instead of risking a duplicate.
    """
    try:
        with get_db() as conn:
            requeued = conn.execute("UPDATE queue SET status = 'pending' WHERE status = 'sending'").rowcount
            flagged = conn.execute("UPDATE queue SET status = 'unconfirmed' WHERE status = 'confirming'").rowcount
            return requeued + flagged
    except Exception as e:
        logging.error(f"Error resetting stuck rows: {e}")
        return 0


def count_pending() -> int:
    """Number of rows waiting to be sent or on their way (pending / empty / sending / confirming)."""
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM queue "
                "WHERE status IS NULL OR status IN ('', 'pending', 'sending', 'confirming')"
            ).fetchone()
            return int(row['c']) if row else 0
    except Exception as e:
        logging.error(f"Error counting pending rows: {e}")
        return 0


def get_stats() -> Dict[str, int]:
    """Return queue statistics."""
    try:
        with get_db() as conn:
            row = conn.execute('''
                SELECT
                    COUNT(*) as total,
                    COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) as sent,
                    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
                    COALESCE(SUM(CASE WHEN status IS NULL OR status IN ('', 'pending', 'sending', 'confirming') THEN 1 ELSE 0 END), 0) as pending,
                    COALESCE(SUM(CASE WHEN status = 'skipped' OR status = 'invalid_phone' THEN 1 ELSE 0 END), 0) as skipped,
                    COALESCE(SUM(CASE WHEN status = 'unconfirmed' THEN 1 ELSE 0 END), 0) as unconfirmed
                FROM queue
            ''').fetchone()
            if row:
                res = dict(row)
                return {k: (v if v is not None else 0) for k, v in res.items()}
            return {"total": 0, "sent": 0, "failed": 0, "pending": 0, "skipped": 0, "unconfirmed": 0}
    except Exception as e:
        logging.error(f"Error getting stats: {e}")
        return {"total": 0, "sent": 0, "failed": 0, "pending": 0, "skipped": 0, "unconfirmed": 0}


def get_idempotency_record(key: str) -> Optional[Dict[str, Any]]:
    """Retrieve an idempotency record by key if within 24 hours."""
    if not key or not str(key).strip():
        return None
    try:
        clean_key = str(key).strip()
        cutoff = (datetime.now() - timedelta(hours=24)).isoformat()
        with get_db() as conn:
            row = conn.execute(
                'SELECT response, created_at, request_hash FROM idempotency_records WHERE key = ? AND created_at >= ?',
                (clean_key, cutoff)
            ).fetchone()
            if row:
                import json
                try:
                    return {
                        'response': json.loads(row['response']),
                        'created_at': row['created_at'],
                        'request_hash': row['request_hash'] if 'request_hash' in row.keys() else '',
                        'replay': True
                    }
                except Exception:
                    return None
    except Exception as e:
        logging.error(f"Error checking idempotency key {key}: {e}")
    return None


def save_idempotency_record(key: str, response: Dict[str, Any], request_hash: str = "") -> bool:
    """Save response with idempotency key and prune records older than 48 hours."""
    if not key or not str(key).strip():
        return False
    try:
        import json
        clean_key = str(key).strip()
        payload_str = json.dumps(response, ensure_ascii=False)
        now = datetime.now().isoformat()
        cutoff = (datetime.now() - timedelta(hours=48)).isoformat()
        with get_db() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO idempotency_records (key, response, created_at, request_hash) VALUES (?, ?, ?, ?)',
                (clean_key, payload_str, now, request_hash)
            )
            conn.execute('DELETE FROM idempotency_records WHERE created_at < ?', (cutoff,))
            return True
    except Exception as e:
        logging.error(f"Error saving idempotency record {key}: {e}")
        return False


# ─── Auto-initialize on import ────────────────────────────────────
init_db()
