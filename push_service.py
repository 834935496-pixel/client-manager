import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

BARK_KEY_PATH = Path("bark_key.txt")
BARK_ENABLED_PATH = Path("bark_enabled.txt")

_bark_key: str = ""
_bark_enabled: bool = False


def init_vapid():
    global _bark_key, _bark_enabled
    if BARK_KEY_PATH.exists():
        _bark_key = BARK_KEY_PATH.read_text().strip()
    _bark_enabled = BARK_ENABLED_PATH.exists()
    if _bark_key:
        print("✅ Bark 推送已配置")
    else:
        print("⚠️  Bark 密钥未配置")


def get_public_key() -> str:
    return "bark"


def is_bark_enabled() -> bool:
    return _bark_enabled and bool(_bark_key)


def enable_bark():
    global _bark_enabled
    _bark_enabled = True
    BARK_ENABLED_PATH.write_text("1")


def disable_bark():
    global _bark_enabled
    _bark_enabled = False
    if BARK_ENABLED_PATH.exists():
        BARK_ENABLED_PATH.unlink()


def send_push(endpoint: str, p256dh: str, auth: str, title: str, body: str, url: str = "/") -> bool:
    return send_bark_push(title, body)


def send_bark_push(title: str, body: str) -> bool:
    if not _bark_key:
        print("Bark key not configured")
        return False
    try:
        t = urllib.parse.quote(title, safe="")
        b = urllib.parse.quote(body, safe="")
        bark_url = f"https://api.day.app/{_bark_key}/{t}/{b}"
        req = urllib.request.Request(bark_url)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"Bark push failed: {e}")
        return False


def send_daily_push():
    if not is_bark_enabled():
        return
    try:
        from database import get_db
        today = date.today().isoformat()
        conn = get_db()
        todos = conn.execute(
            """SELECT t.*, co.name as company_name FROM todos t
               LEFT JOIN companies co ON t.company_id=co.id
               WHERE t.done=0 AND t.date <= ?
                 AND (t.end_date IS NULL OR t.end_date='' OR t.end_date >= ?)
               ORDER BY t.priority DESC, t.date""",
            (today, today),
        ).fetchall()
        conn.close()

        if not todos:
            return

        count = len(todos)
        high = sum(1 for t in todos if t["priority"] == "high")
        body = f"今日共 {count} 项待办" + (f"，{high} 项高优先级" if high else "")
        names = []
        for t in list(todos)[:3]:
            n = t["content"][:12]
            if t["company_name"]:
                n = f"[{t['company_name'][:5]}]{n}"
            names.append(n)
        if names:
            body += "\n" + "、".join(names)

        send_bark_push("📋 今日待办提醒", body)
    except Exception as e:
        print(f"Daily push job error: {e}")
