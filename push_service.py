import base64
import json
import time as _time
from datetime import date
from pathlib import Path

VAPID_PRIVATE_PATH = Path("vapid_private.pem")
VAPID_PUBLIC_PATH  = Path("vapid_public.txt")

_public_b64: str = ""


def init_vapid():
    global _public_b64
    if VAPID_PRIVATE_PATH.exists() and VAPID_PUBLIC_PATH.exists():
        _public_b64 = VAPID_PUBLIC_PATH.read_text().strip()
        print("✅ VAPID 密钥已加载")
        return
    try:
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import serialization

        priv = ec.generate_private_key(ec.SECP256R1(), default_backend())

        # PKCS8 格式——pywebpush/py_vapid 能正确解析
        private_pem = priv.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        VAPID_PRIVATE_PATH.write_text(private_pem)

        pub_bytes = priv.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        _public_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()
        VAPID_PUBLIC_PATH.write_text(_public_b64)
        print("✅ VAPID 密钥已生成（PKCS8）")
    except Exception as e:
        print(f"⚠️  VAPID 初始化失败：{e}")


def get_public_key() -> str:
    return _public_b64


def send_push(endpoint: str, p256dh: str, auth: str, title: str, body: str, url: str = "/") -> bool:
    if not VAPID_PRIVATE_PATH.exists():
        print("VAPID private key not found")
        return False
    try:
        from pywebpush import webpush, WebPushException
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=str(VAPID_PRIVATE_PATH),   # 传文件路径
            vapid_claims={"sub": "mailto:admin@example.com", "exp": int(_time.time()) + 3600},
        )
        return True
    except Exception as e:
        print(f"Push failed: {type(e).__name__}: {e}")
        return False


def send_daily_push():
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
        subs = conn.execute("SELECT * FROM push_subscriptions").fetchall()
        conn.close()

        if not todos or not subs:
            return

        count = len(todos)
        high  = sum(1 for t in todos if t["priority"] == "high")
        body  = f"今日共 {count} 项待办" + (f"，{high} 项高优先级" if high else "")
        names = []
        for t in list(todos)[:3]:
            n = t["content"][:12]
            if t["company_name"]:
                n = f"[{t['company_name'][:5]}]{n}"
            names.append(n)
        if names:
            body += "\n" + "  ".join(names)

        failed = []
        for sub in subs:
            ok = send_push(sub["endpoint"], sub["p256dh"], sub["auth"],
                           "📋 今日待办提醒", body)
            if not ok:
                failed.append(sub["id"])

        if failed:
            conn2 = get_db()
            for fid in failed:
                conn2.execute("DELETE FROM push_subscriptions WHERE id=?", (fid,))
            conn2.commit()
            conn2.close()
    except Exception as e:
        print(f"Daily push job error: {e}")
