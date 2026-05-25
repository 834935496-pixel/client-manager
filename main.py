import json
import os
from datetime import date
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uuid
import shutil
from pathlib import Path
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

from database import get_db, init_db, row_to_dict
from ai_service import chat, chat_with_web_search, build_company_context
from push_service import init_vapid, get_public_key, send_push, send_daily_push

app = FastAPI(title="客户档案系统")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ACCESS_PASSWORD = os.getenv("ACCESS_PASSWORD", "")


@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    response = await call_next(request)
    ct = response.headers.get("content-type", "")
    path = request.url.path
    if "text/html" in ct or path == "/sw.js" or path.startswith("/app.js") or path.startswith("/style.css"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not ACCESS_PASSWORD:
        return await call_next(request)
    if request.url.path.startswith("/api/") and request.url.path not in ("/api/auth", "/api/version") and not request.url.path.startswith("/api/calendar"):
        if request.headers.get("X-Access-Token", "") != ACCESS_PASSWORD:
            return JSONResponse(status_code=401, content={"detail": "未授权"})
    return await call_next(request)


APP_VERSION = "39"

@app.get("/api/version")
async def get_version():
    return {"version": APP_VERSION}


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/auth")
async def auth(request: Request):
    body = await request.json()
    if body.get("password") == ACCESS_PASSWORD or not ACCESS_PASSWORD:
        return {"ok": True, "token": ACCESS_PASSWORD}
    raise HTTPException(status_code=401, detail="密码错误")


# ── Companies ─────────────────────────────────────────────────────────────────

class CompanyBody(BaseModel):
    name: str
    industry: str = ""
    level: str = "B"
    credit_limit: float = 0
    products: list = []
    tags: list = []
    notes: str = ""
    legal_rep: str = ""
    legal_rep_id: str = ""
    credit_code: str = ""
    reg_capital: str = ""
    established_date: str = ""
    reg_address: str = ""
    biz_scope: str = ""
    company_scale: str = ""
    office_address: str = ""
    employee_count: str = ""
    operating_scope: str = ""
    products_assets: list = []
    products_liabilities: list = []
    products_intermediary: list = []


@app.get("/api/companies")
def list_companies(q: str = ""):
    conn = get_db()
    if q:
        rows = conn.execute(
            """SELECT c.*,
               (SELECT name FROM contacts WHERE company_id=c.id AND is_primary=1 LIMIT 1) as primary_contact,
               (SELECT COUNT(*) FROM contacts WHERE company_id=c.id) as contact_count
               FROM companies c WHERE c.name LIKE ? ORDER BY c.level, c.updated_at DESC""",
            (f"%{q}%",),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT c.*,
               (SELECT name FROM contacts WHERE company_id=c.id AND is_primary=1 LIMIT 1) as primary_contact,
               (SELECT COUNT(*) FROM contacts WHERE company_id=c.id) as contact_count
               FROM companies c ORDER BY c.level, c.updated_at DESC"""
        ).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


@app.post("/api/companies")
def create_company(body: CompanyBody):
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO companies (name, industry, level, credit_limit, products, tags, notes,
             legal_rep, legal_rep_id, credit_code, reg_capital, established_date, reg_address, biz_scope,
             company_scale, office_address, employee_count, operating_scope,
             products_assets, products_liabilities, products_intermediary)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (body.name, body.industry, body.level, body.credit_limit,
         json.dumps(body.products, ensure_ascii=False),
         json.dumps(body.tags, ensure_ascii=False), body.notes,
         body.legal_rep, body.legal_rep_id, body.credit_code, body.reg_capital,
         body.established_date, body.reg_address, body.biz_scope,
         body.company_scale, body.office_address, body.employee_count, body.operating_scope,
         json.dumps(body.products_assets, ensure_ascii=False),
         json.dumps(body.products_liabilities, ensure_ascii=False),
         json.dumps(body.products_intermediary, ensure_ascii=False)),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM companies WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return row_to_dict(row)


@app.get("/api/companies/{company_id}")
def get_company(company_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM companies WHERE id=?", (company_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "企业不存在")
    return row_to_dict(row)


@app.put("/api/companies/{company_id}")
def update_company(company_id: int, body: CompanyBody):
    conn = get_db()
    conn.execute(
        """UPDATE companies SET name=?, industry=?, level=?, credit_limit=?, products=?, tags=?, notes=?,
             legal_rep=?, legal_rep_id=?, credit_code=?, reg_capital=?, established_date=?, reg_address=?, biz_scope=?,
             company_scale=?, office_address=?, employee_count=?, operating_scope=?,
             products_assets=?, products_liabilities=?, products_intermediary=?,
             updated_at=datetime('now','localtime') WHERE id=?""",
        (body.name, body.industry, body.level, body.credit_limit,
         json.dumps(body.products, ensure_ascii=False),
         json.dumps(body.tags, ensure_ascii=False), body.notes,
         body.legal_rep, body.legal_rep_id, body.credit_code, body.reg_capital,
         body.established_date, body.reg_address, body.biz_scope,
         body.company_scale, body.office_address, body.employee_count, body.operating_scope,
         json.dumps(body.products_assets, ensure_ascii=False),
         json.dumps(body.products_liabilities, ensure_ascii=False),
         json.dumps(body.products_intermediary, ensure_ascii=False), company_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM companies WHERE id=?", (company_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


# ── Company Products (台账) ────────────────────────────────────────────────────

class ProductBody(BaseModel):
    category: str
    product_name: str
    amount: float = 0
    credit_type: str = ""
    loan_amount: float = 0
    start_date: str = ""
    end_date: str = ""
    notes: str = ""

@app.get("/api/companies/{company_id}/products")
def list_company_products(company_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM company_products WHERE company_id=? ORDER BY category, end_date",
        (company_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/companies/{company_id}/products")
def create_company_product(company_id: int, body: ProductBody):
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO company_products (company_id, category, product_name, amount, credit_type, loan_amount, start_date, end_date, notes)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (company_id, body.category, body.product_name, body.amount,
         body.credit_type, body.loan_amount, body.start_date, body.end_date, body.notes)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM company_products WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)

@app.put("/api/companies/{company_id}/products/{product_id}")
def update_company_product(company_id: int, product_id: int, body: ProductBody):
    conn = get_db()
    conn.execute(
        """UPDATE company_products SET category=?, product_name=?, amount=?, credit_type=?, loan_amount=?, start_date=?, end_date=?, notes=?
           WHERE id=? AND company_id=?""",
        (body.category, body.product_name, body.amount, body.credit_type, body.loan_amount,
         body.start_date, body.end_date, body.notes, product_id, company_id)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM company_products WHERE id=?", (product_id,)).fetchone()
    conn.close()
    return dict(row)

@app.delete("/api/companies/{company_id}/products/{product_id}")
def delete_company_product(company_id: int, product_id: int):
    conn = get_db()
    conn.execute("DELETE FROM company_products WHERE id=? AND company_id=?", (product_id, company_id))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/products/expiring")
def expiring_products(days: int = 30):
    from datetime import date, timedelta
    today = date.today().isoformat()
    deadline = (date.today() + timedelta(days=days)).isoformat()
    conn = get_db()
    rows = conn.execute(
        """SELECT cp.*, c.name as company_name FROM company_products cp
           JOIN companies c ON cp.company_id=c.id
           WHERE cp.end_date != '' AND cp.end_date BETWEEN ? AND ?
           ORDER BY cp.end_date""",
        (today, deadline)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.delete("/api/companies/{company_id}")
def delete_company(company_id: int):
    conn = get_db()
    conn.execute("DELETE FROM companies WHERE id=?", (company_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Contacts ──────────────────────────────────────────────────────────────────

class ContactBody(BaseModel):
    company_id: int
    name: str
    position: str = ""
    phone: str = ""
    wechat: str = ""
    email: str = ""
    is_primary: bool = False
    notes: str = ""


@app.get("/api/companies/{company_id}/contacts")
def list_contacts(company_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM contacts WHERE company_id=? ORDER BY is_primary DESC, created_at",
        (company_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/contacts")
def create_contact(body: ContactBody):
    conn = get_db()
    if body.is_primary:
        conn.execute("UPDATE contacts SET is_primary=0 WHERE company_id=?", (body.company_id,))
    cur = conn.execute(
        """INSERT INTO contacts (company_id, name, position, phone, wechat, email, is_primary, notes)
           VALUES (?,?,?,?,?,?,?,?)""",
        (body.company_id, body.name, body.position, body.phone,
         body.wechat, body.email, 1 if body.is_primary else 0, body.notes),
    )
    conn.execute(
        "UPDATE companies SET updated_at=datetime('now','localtime') WHERE id=?",
        (body.company_id,),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM contacts WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@app.put("/api/contacts/{contact_id}")
def update_contact(contact_id: int, body: ContactBody):
    conn = get_db()
    if body.is_primary:
        conn.execute("UPDATE contacts SET is_primary=0 WHERE company_id=?", (body.company_id,))
    conn.execute(
        """UPDATE contacts SET name=?, position=?, phone=?, wechat=?, email=?, is_primary=?, notes=?
           WHERE id=?""",
        (body.name, body.position, body.phone, body.wechat, body.email,
         1 if body.is_primary else 0, body.notes, contact_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM contacts WHERE id=?", (contact_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/contacts/{contact_id}")
def delete_contact(contact_id: int):
    conn = get_db()
    conn.execute("DELETE FROM contacts WHERE id=?", (contact_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Interactions ──────────────────────────────────────────────────────────────

class InteractionBody(BaseModel):
    company_id: int
    contact_id: Optional[int] = None
    date: str
    type: str
    content: str
    next_action: str = ""


@app.get("/api/companies/{company_id}/interactions")
def list_interactions(company_id: int):
    conn = get_db()
    rows = conn.execute(
        """SELECT i.*, c.name as contact_name FROM interactions i
           LEFT JOIN contacts c ON i.contact_id=c.id
           WHERE i.company_id=? ORDER BY i.date DESC, i.created_at DESC""",
        (company_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/interactions")
def create_interaction(body: InteractionBody):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO interactions (company_id, contact_id, date, type, content, next_action) VALUES (?,?,?,?,?,?)",
        (body.company_id, body.contact_id, body.date, body.type, body.content, body.next_action),
    )
    conn.execute(
        "UPDATE companies SET updated_at=datetime('now','localtime') WHERE id=?",
        (body.company_id,),
    )
    conn.commit()
    row = conn.execute(
        """SELECT i.*, c.name as contact_name FROM interactions i
           LEFT JOIN contacts c ON i.contact_id=c.id WHERE i.id=?""",
        (cur.lastrowid,),
    ).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/interactions/{interaction_id}")
def delete_interaction(interaction_id: int):
    conn = get_db()
    conn.execute("DELETE FROM interactions WHERE id=?", (interaction_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Todos ─────────────────────────────────────────────────────────────────────

class TodoBody(BaseModel):
    company_id: Optional[int] = None
    contact_id: Optional[int] = None
    date: str
    end_date: str = ""
    content: str
    priority: str = "medium"
    sub_items: list = []


@app.get("/api/todos")
def list_todos(date_filter: str = "", company_id: Optional[int] = None):
    conn = get_db()
    query = """
        SELECT t.*, co.name as company_name, c.name as contact_name,
               (SELECT COUNT(*) FROM todo_documents WHERE todo_id=t.id) as doc_count
        FROM todos t
        LEFT JOIN companies co ON t.company_id=co.id
        LEFT JOIN contacts c ON t.contact_id=c.id
        WHERE 1=1
    """
    params = []
    if date_filter:
        query += " AND t.date = ?"
        params.append(date_filter)
    if company_id:
        query += " AND t.company_id = ?"
        params.append(company_id)
    query += " ORDER BY t.done, t.priority DESC, t.date"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/todos")
def create_todo(body: TodoBody):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO todos (company_id, contact_id, date, end_date, content, priority, sub_items) VALUES (?,?,?,?,?,?,?)",
        (body.company_id, body.contact_id, body.date, body.end_date, body.content, body.priority,
         json.dumps(body.sub_items, ensure_ascii=False)),
    )
    conn.commit()
    row = conn.execute(
        """SELECT t.*, co.name as company_name, c.name as contact_name
           FROM todos t LEFT JOIN companies co ON t.company_id=co.id
           LEFT JOIN contacts c ON t.contact_id=c.id WHERE t.id=?""",
        (cur.lastrowid,),
    ).fetchone()
    conn.close()
    return dict(row)


@app.put("/api/todos/{todo_id}")
def update_todo(todo_id: int, body: TodoBody):
    conn = get_db()
    conn.execute(
        "UPDATE todos SET date=?, end_date=?, content=?, priority=?, sub_items=? WHERE id=?",
        (body.date, body.end_date, body.content, body.priority,
         json.dumps(body.sub_items, ensure_ascii=False), todo_id),
    )
    conn.commit()
    row = conn.execute(
        """SELECT t.*, co.name as company_name FROM todos t
           LEFT JOIN companies co ON t.company_id=co.id WHERE t.id=?""",
        (todo_id,),
    ).fetchone()
    conn.close()
    return dict(row)


class SubItemsBody(BaseModel):
    sub_items: list = []

@app.patch("/api/todos/{todo_id}/sub_items")
def update_sub_items(todo_id: int, body: SubItemsBody):
    conn = get_db()
    conn.execute("UPDATE todos SET sub_items=? WHERE id=?",
                 (json.dumps(body.sub_items, ensure_ascii=False), todo_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.patch("/api/todos/{todo_id}/toggle")
def toggle_todo(todo_id: int):
    conn = get_db()
    conn.execute("UPDATE todos SET done = 1 - done WHERE id=?", (todo_id,))
    conn.commit()
    row = conn.execute(
        """SELECT t.*, co.name as company_name, c.name as contact_name
           FROM todos t LEFT JOIN companies co ON t.company_id=co.id
           LEFT JOIN contacts c ON t.contact_id=c.id WHERE t.id=?""",
        (todo_id,),
    ).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: int):
    conn = get_db()
    conn.execute("DELETE FROM todos WHERE id=?", (todo_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Todo Documents ─────────────────────────────────────────────────────────────

TODO_DOC_ALLOWED = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".ppt", ".pptx", ".txt", ".csv", ".md",
    ".jpg", ".jpeg", ".png",
}

@app.get("/api/todos/{todo_id}/documents")
def list_todo_documents(todo_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM todo_documents WHERE todo_id=? ORDER BY uploaded_at DESC",
        (todo_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/todos/{todo_id}/documents")
async def upload_todo_document(todo_id: int, file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in TODO_DOC_ALLOWED:
        raise HTTPException(400, f"不支持的文件格式")
    saved_name = f"todo_{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / saved_name
    content = await file.read()
    dest.write_bytes(content)
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO todo_documents (todo_id, filename, original_name, size) VALUES (?,?,?,?)",
        (todo_id, saved_name, file.filename, len(content)),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM todo_documents WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/todo_documents/{doc_id}/download")
def download_todo_document(doc_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM todo_documents WHERE id=?", (doc_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "文件不存在")
    path = UPLOAD_DIR / row["filename"]
    if not path.exists():
        raise HTTPException(404, "文件已丢失")
    ext = Path(row["original_name"]).suffix.lower()
    mime = MIME_TYPES.get(ext, "application/octet-stream")
    if ext in {".jpg", ".jpeg"}:
        mime = "image/jpeg"
    elif ext == ".png":
        mime = "image/png"
    return FileResponse(path, filename=row["original_name"], media_type=mime)


@app.delete("/api/todo_documents/{doc_id}")
def delete_todo_document(doc_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM todo_documents WHERE id=?", (doc_id,)).fetchone()
    if row:
        path = UPLOAD_DIR / row["filename"]
        if path.exists():
            path.unlink()
        conn.execute("DELETE FROM todo_documents WHERE id=?", (doc_id,))
        conn.commit()
    conn.close()
    return {"ok": True}


# ── AI ────────────────────────────────────────────────────────────────────────

class AIChatBody(BaseModel):
    message: str
    company_id: Optional[int] = None
    mode: str = "fast"
    history: list = []


@app.post("/api/ai/chat")
def ai_chat(body: AIChatBody):
    messages = list(body.history)

    if body.company_id:
        conn = get_db()
        company = row_to_dict(
            conn.execute("SELECT * FROM companies WHERE id=?", (body.company_id,)).fetchone()
        )
        contacts = [dict(r) for r in conn.execute(
            "SELECT * FROM contacts WHERE company_id=? ORDER BY is_primary DESC", (body.company_id,)
        ).fetchall()]
        interactions = [dict(r) for r in conn.execute(
            """SELECT i.*, c.name as contact_name FROM interactions i
               LEFT JOIN contacts c ON i.contact_id=c.id
               WHERE i.company_id=? ORDER BY i.date DESC LIMIT 30""",
            (body.company_id,),
        ).fetchall()]
        todos = [dict(r) for r in conn.execute(
            "SELECT * FROM todos WHERE company_id=? ORDER BY date", (body.company_id,)
        ).fetchall()]
        conn.close()

        context = build_company_context(company, contacts, interactions, todos)
        messages.insert(0, {"role": "user", "content": f"以下是该企业的档案信息：\n\n{context}"})
        messages.insert(1, {"role": "assistant", "content": "好的，我已了解该企业的档案信息，请问您有什么需要分析或处理的？"})

    messages.append({"role": "user", "content": body.message})

    try:
        if body.mode == "web":
            reply = chat_with_web_search(messages)
        else:
            reply = chat(messages, mode=body.mode)
        return {"reply": reply, "mode": body.mode}
    except Exception as e:
        raise HTTPException(500, f"AI 服务错误：{str(e)}")


@app.post("/api/ai/search")
def ai_search(body: AIChatBody):
    conn = get_db()
    companies = [row_to_dict(r) for r in conn.execute(
        "SELECT * FROM companies ORDER BY level, name"
    ).fetchall()]

    blocks = [f"=== 客户档案总览（共 {len(companies)} 家企业）==="]
    for co in companies:
        contacts = conn.execute(
            "SELECT name, position, phone FROM contacts WHERE company_id=? ORDER BY is_primary DESC LIMIT 3",
            (co["id"],),
        ).fetchall()
        recent = conn.execute(
            "SELECT date, type, content, next_action FROM interactions WHERE company_id=? ORDER BY date DESC LIMIT 5",
            (co["id"],),
        ).fetchall()
        todos = conn.execute(
            "SELECT date, content FROM todos WHERE company_id=? AND done=0 ORDER BY date LIMIT 3",
            (co["id"],),
        ).fetchall()

        products = "、".join(co.get("products") or []) or "—"
        block = [f"\n【{co['name']}】等级:{co['level']} | 行业:{co['industry'] or '—'} | 授信:{co['credit_limit']}万 | 产品:{products}"]
        if contacts:
            ct = " / ".join(f"{r[0]}{'·'+r[1] if r[1] else ''}{' '+r[2] if r[2] else ''}" for r in contacts)
            block.append(f"  联系人: {ct}")
        for r in recent:
            line = f"  [{r[0]}]{r[1]}: {r[2][:60]}"
            if r[3]:
                line += f" → {r[3][:30]}"
            block.append(line)
        for t in todos:
            block.append(f"  待办[{t[0]}]: {t[1][:40]}")
        blocks.extend(block)

    conn.close()
    context = "\n".join(blocks)

    messages = [
        {"role": "user", "content": f"以下是我管理的全部客户档案信息：\n\n{context}"},
        {"role": "assistant", "content": "好的，我已了解您所有客户的档案，请问您想查询什么？"},
    ]
    messages.extend(body.history)
    messages.append({"role": "user", "content": body.message})

    try:
        reply = chat(messages, mode="cloud")
        return {"reply": reply, "mode": "cloud"}
    except Exception as e:
        raise HTTPException(500, f"AI 服务错误：{str(e)}")


@app.get("/api/ai/company-research/{company_id}")
def ai_company_research(company_id: int):
    conn = get_db()
    row = conn.execute("SELECT name, industry FROM companies WHERE id=?", (company_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "企业不存在")

    name, industry = row[0], row[1] or "所在行业"
    prompt = f"""请联网搜索企业「{name}」的最新公开信息，从银行客户经理视角输出以下内容：

1. **企业概况**：成立时间、注册地、实控人/股权结构、注册资本
2. **主营业务**：核心产品或服务、主要客户/市场
3. **行业地位**：在{industry}中的竞争地位、规模排名
4. **财务概况**：营收量级、盈利状况（近年公开数据或估算）
5. **信用与合规风险**：公开失信记录、行政处罚、重大诉讼纠纷
6. **近期重要动态**：融资、重大合同、人事变动、扩张或收缩迹象
7. **银行合作视角**：主要授信机遇与潜在风险点

请优先使用最新网络数据。若该企业规模较小信息有限，请如实说明。"""

    try:
        reply = chat_with_web_search([{"role": "user", "content": prompt}])
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(500, f"AI 服务错误：{str(e)}")


@app.get("/api/ai/company-autofill/{company_id}")
def ai_company_autofill(company_id: int):
    conn = get_db()
    row = conn.execute("SELECT name FROM companies WHERE id=?", (company_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "企业不存在")

    name = row[0]
    # Step 1: Kimi searches freely in natural language (no JSON constraint)
    search_prompt = f"""请联网搜索「{name}」的详细企业信息，需要找到以下内容：
1. 法定代表人/董事长姓名
2. 统一社会信用代码（18位）
3. 注册资本
4. 成立日期
5. 工商注册地址
6. 实际办公地址
7. 主营业务简介
8. 工商登记经营范围（完整文本）
9. 所属行业
10. 企业规模（大型/中型/小型/微型）
11. 员工人数

请尽量从天眼查、企查查、官网等多个来源核实，给出准确信息。"""

    try:
        search_result = chat_with_web_search([{"role": "user", "content": search_prompt}], max_tokens=4096)

        # Step 2: local fast model extracts structured JSON from the search result
        extract_prompt = f"""从下面的企业信息文本中提取结构化数据，只返回JSON不要其他内容，找不到的字段填空字符串""：

{search_result}

返回格式：
{{"legal_rep":"法定代表人姓名","credit_code":"18位社会信用代码","reg_capital":"注册资本","established_date":"成立日期YYYY-MM-DD","reg_address":"注册地址","biz_scope":"主营业务50字内","industry":"行业10字内","company_scale":"大型企业或中型企业或小型企业或微型企业","office_address":"办公地址","employee_count":"员工人数","operating_scope":"工商登记经营范围完整文本"}}"""

        import re as _re
        raw = chat([{"role": "user", "content": extract_prompt}], mode="fast")
        raw_clean = _re.sub(r'```(?:json)?\s*', '', raw).strip().rstrip('`').strip()
        start, end = raw_clean.find('{'), raw_clean.rfind('}')
        fields = json.loads(raw_clean[start:end + 1]) if start != -1 else {}
        placeholder_words = {"法定代表人姓名", "统一社会信用代码", "注册资本", "注册地址", "主营业务", "所属行业", "成立日期", "员工人数", "办公地址"}
        scale_map = {"大型": "大型企业", "中型": "中型企业", "小型": "小型企业", "微型": "微型企业"}
        cleaned = {}
        for k, v in fields.items():
            v = (v or "").strip()
            if not v or v in placeholder_words or "（" in v[:6]:
                continue
            if k == "company_scale":
                v = scale_map.get(v, v)
                if v not in {"大型企业", "中型企业", "小型企业", "微型企业"}:
                    continue
            cleaned[k] = v[:100] if k == "biz_scope" else v
        return {"fields": cleaned}
    except Exception as e:
        raise HTTPException(500, f"AI 服务错误：{str(e)}")


class ExtractBody(BaseModel):
    text: str

@app.post("/api/ai/extract-fields")
def ai_extract_fields(body: ExtractBody):
    import re as _re
    extract_prompt = f"""从下面的企业信息文本中提取结构化数据，只返回JSON不要其他内容，找不到的字段填空字符串""：

{body.text}

返回格式：
{{"legal_rep":"法定代表人姓名","credit_code":"18位社会信用代码","reg_capital":"注册资本","established_date":"成立日期YYYY-MM-DD","reg_address":"注册地址","biz_scope":"主营业务50字内","industry":"行业10字内","company_scale":"大型企业或中型企业或小型企业或微型企业","office_address":"办公地址","employee_count":"员工人数","operating_scope":"工商登记经营范围完整文本"}}"""
    try:
        raw = chat([{"role": "user", "content": extract_prompt}], mode="fast")
        raw_clean = _re.sub(r'```(?:json)?\s*', '', raw).strip().rstrip('`').strip()
        start, end = raw_clean.find('{'), raw_clean.rfind('}')
        fields = json.loads(raw_clean[start:end + 1]) if start != -1 else {}
        placeholder_words = {"法定代表人姓名", "统一社会信用代码", "注册资本", "注册地址", "主营业务", "所属行业", "成立日期", "员工人数", "办公地址"}
        scale_map = {"大型": "大型企业", "中型": "中型企业", "小型": "小型企业", "微型": "微型企业"}
        cleaned = {}
        for k, v in fields.items():
            v = (v or "").strip()
            if not v or v in placeholder_words or "（" in v[:6]:
                continue
            if k == "company_scale":
                v = scale_map.get(v, v)
                if v not in {"大型企业", "中型企业", "小型企业", "微型企业"}:
                    continue
            cleaned[k] = v[:200] if k == "operating_scope" else (v[:100] if k == "biz_scope" else v)
        return {"fields": cleaned}
    except Exception as e:
        raise HTTPException(500, f"AI 服务错误：{str(e)}")


@app.get("/api/ai/daily-brief")
def daily_brief():
    today = date.today().isoformat()
    conn = get_db()
    todos = conn.execute(
        """SELECT t.*, co.name as company_name
           FROM todos t LEFT JOIN companies co ON t.company_id=co.id
           WHERE t.date <= ? AND t.done=0 ORDER BY t.priority DESC""",
        (today,),
    ).fetchall()
    conn.close()

    if not todos:
        return {"reply": "今日没有待办事项，可以主动拓展新客户或跟进潜在业务。", "mode": "fast"}

    todo_text = "\n".join(
        f"- {'[' + r['company_name'] + '] ' if r['company_name'] else ''}[{r['date']}] {r['content']}"
        for r in todos
    )
    prompt = f"今日是{today}，以下是今日及逾期未完成的待办事项：\n\n{todo_text}\n\n请帮我梳理优先级并给出今日工作建议，简洁实用。"

    try:
        reply = chat([{"role": "user", "content": prompt}], mode="fast")
        return {"reply": reply, "mode": "fast"}
    except Exception as e:
        return {"reply": f"AI 暂时不可用：{str(e)}", "mode": "error"}


# ── PDF Import ────────────────────────────────────────────────────────────────

PDF_PARSE_PROMPT = """你是数据提取助手。从以下PDF文本中提取所有企业客户信息，返回JSON数组。

每个对象代表一家企业，包含：
- name: 企业名称
- industry: 行业
- level: 客户等级（A/B/C，不确定填B）
- credit_limit: 授信额度，纯数字，单位万元（没有填0）
- products: 合作产品数组，如["贷款","存款"]
- notes: 备注
- contacts: 联系人数组，每个联系人包含 {name, position, phone, wechat, email, is_primary}

只返回JSON数组，不要任何解释。格式：
[{"name":"XX公司","industry":"","level":"B","credit_limit":0,"products":[],"notes":"","contacts":[{"name":"张总","position":"董事长","phone":"138...","wechat":"","email":"","is_primary":true}]}]

PDF文本：
"""


@app.post("/api/import/pdf/preview")
async def pdf_preview(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "请上传 PDF 文件")

    import pdfplumber, io
    content = await file.read()
    text_parts = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text_parts.append(t)

    full_text = "\n".join(text_parts).strip()
    if not full_text:
        raise HTTPException(400, "PDF 中未提取到文字，请确认已 OCR 处理")

    if len(full_text) > 12000:
        full_text = full_text[:12000] + "\n...(内容过长已截断)"

    try:
        reply = chat([{"role": "user", "content": PDF_PARSE_PROMPT + full_text}], mode="fast")
        start = reply.find("[")
        end = reply.rfind("]") + 1
        if start == -1 or end == 0:
            raise ValueError("AI 未返回有效 JSON")
        companies = json.loads(reply[start:end])
        return {"companies": companies, "total": len(companies)}
    except Exception as e:
        raise HTTPException(500, f"AI 解析失败：{str(e)}")


@app.post("/api/import/pdf/confirm")
async def pdf_confirm(request: Request):
    body = await request.json()
    companies_data = body.get("companies", [])
    if not companies_data:
        raise HTTPException(400, "没有要导入的数据")

    conn = get_db()
    imported = 0
    skipped = 0
    for c in companies_data:
        if not c.get("name"):
            skipped += 1
            continue
        cur = conn.execute(
            """INSERT INTO companies (name, industry, level, credit_limit, products, tags, notes)
               VALUES (?,?,?,?,?,?,?)""",
            (c.get("name", ""), c.get("industry", ""), c.get("level", "B"),
             float(c.get("credit_limit", 0) or 0),
             json.dumps(c.get("products", []), ensure_ascii=False), "[]",
             c.get("notes", "")),
        )
        company_id = cur.lastrowid
        for idx, ct in enumerate(c.get("contacts", [])):
            if not ct.get("name"):
                continue
            conn.execute(
                """INSERT INTO contacts (company_id, name, position, phone, wechat, email, is_primary)
                   VALUES (?,?,?,?,?,?,?)""",
                (company_id, ct.get("name", ""), ct.get("position", ""),
                 ct.get("phone", ""), ct.get("wechat", ""), ct.get("email", ""),
                 1 if (ct.get("is_primary") or idx == 0) else 0),
            )
        imported += 1
    conn.commit()
    conn.close()
    return {"imported": imported, "skipped": skipped}


# ── Documents ─────────────────────────────────────────────────────────────────

UPLOAD_DIR = Path("uploads")

ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".ppt", ".pptx", ".txt", ".csv", ".md",
}

MIME_TYPES = {
    ".pdf":  "application/pdf",
    ".doc":  "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls":  "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt":  "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt":  "text/plain",
    ".csv":  "text/csv",
    ".md":   "text/markdown",
}


@app.get("/api/companies/{company_id}/documents")
def list_documents(company_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM documents WHERE company_id=? ORDER BY uploaded_at DESC",
        (company_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/companies/{company_id}/documents")
async def upload_document(
    company_id: int,
    file: UploadFile = File(...),
    category: str = Form("其他"),
):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"不支持的文件格式，支持：{', '.join(ALLOWED_EXTENSIONS)}")
    saved_name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / saved_name
    content = await file.read()
    dest.write_bytes(content)
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO documents (company_id, filename, original_name, size, category) VALUES (?,?,?,?,?)",
        (company_id, saved_name, file.filename, len(content), category),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM documents WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/documents/{doc_id}/download")
def download_document(doc_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "文件不存在")
    path = UPLOAD_DIR / row["filename"]
    if not path.exists():
        raise HTTPException(404, "文件已丢失")
    ext = Path(row["original_name"]).suffix.lower()
    mime = MIME_TYPES.get(ext, "application/octet-stream")
    return FileResponse(path, filename=row["original_name"], media_type=mime)


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    if row:
        path = UPLOAD_DIR / row["filename"]
        if path.exists():
            path.unlink()
        conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))
        conn.commit()
    conn.close()
    return {"ok": True}


# ── Web Push ──────────────────────────────────────────────────────────────────

class PushSubBody(BaseModel):
    endpoint: str
    p256dh: str
    auth: str

@app.get("/api/push/vapid-key")
def push_vapid_key():
    return {"public_key": get_public_key()}

@app.post("/api/push/subscribe")
def push_subscribe(body: PushSubBody):
    conn = get_db()
    conn.execute(
        """INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?,?,?)
           ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth""",
        (body.endpoint, body.p256dh, body.auth),
    )
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/push/subscribe")
def push_unsubscribe(body: PushSubBody):
    conn = get_db()
    conn.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (body.endpoint,))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.post("/api/push/test")
def push_test():
    conn = get_db()
    subs = conn.execute("SELECT * FROM push_subscriptions").fetchall()
    conn.close()
    if not subs:
        raise HTTPException(400, "尚未订阅推送，请先在浏览器中开启通知权限")
    ok_count = 0
    for sub in subs:
        if send_push(sub["endpoint"], sub["p256dh"], sub["auth"],
                     "📋 推送测试成功", "每天早上 8 点将自动发送今日待办提醒"):
            ok_count += 1
    if ok_count == 0:
        raise HTTPException(500, "推送发送失败，请检查网络或重新订阅")
    return {"ok": True, "sent": ok_count}


# ── 财务状况 ─────────────────────────────────────────────────────────────────

@app.get("/api/companies/{company_id}/financials")
def list_financials(company_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, year, unit, source_doc, extracted_at FROM company_financials WHERE company_id=? ORDER BY year DESC",
        (company_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/companies/{company_id}/financials/{year}")
def get_financial(company_id: int, year: int):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM company_financials WHERE company_id=? AND year=?",
        (company_id, year),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "无此年份数据")
    d = dict(row)
    for field in ("balance_sheet", "income", "balance_sheet_parent", "income_parent",
                  "cash_flow_consolidated", "cash_flow_parent"):
        d[field] = json.loads(d.get(field) or "[]")
    return d


class FinancialBody(BaseModel):
    year: int
    unit: str = "万元"
    balance_sheet: list = []
    income: list = []
    balance_sheet_parent: list = []
    income_parent: list = []
    cash_flow_consolidated: list = []
    cash_flow_parent: list = []
    source_doc: str = ""


@app.post("/api/companies/{company_id}/financials")
def save_financial(company_id: int, body: FinancialBody):
    conn = get_db()
    conn.execute(
        """INSERT INTO company_financials
             (company_id, year, unit, balance_sheet, income,
              balance_sheet_parent, income_parent, cash_flow_consolidated, cash_flow_parent, source_doc)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(company_id, year) DO UPDATE SET
             unit=excluded.unit,
             balance_sheet=excluded.balance_sheet,
             income=excluded.income,
             balance_sheet_parent=excluded.balance_sheet_parent,
             income_parent=excluded.income_parent,
             cash_flow_consolidated=excluded.cash_flow_consolidated,
             cash_flow_parent=excluded.cash_flow_parent,
             source_doc=excluded.source_doc,
             extracted_at=datetime('now','localtime')""",
        (company_id, body.year, body.unit,
         json.dumps(body.balance_sheet, ensure_ascii=False),
         json.dumps(body.income, ensure_ascii=False),
         json.dumps(body.balance_sheet_parent, ensure_ascii=False),
         json.dumps(body.income_parent, ensure_ascii=False),
         json.dumps(body.cash_flow_consolidated, ensure_ascii=False),
         json.dumps(body.cash_flow_parent, ensure_ascii=False),
         body.source_doc),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/companies/{company_id}/financials/{year}")
def delete_financial(company_id: int, year: int):
    conn = get_db()
    conn.execute("DELETE FROM company_financials WHERE company_id=? AND year=?", (company_id, year))
    conn.commit()
    conn.close()
    return {"ok": True}


VISION_MODEL = "moonshot-v1-8k-vision-preview"

_FIN_PROMPT = """这是审计报告的一页，请识别并提取财务数据，只返回JSON，不要任何说明文字。

【第一步】识别报表主体（scope）：
- 页面标题含"合并" → scope="consolidated"
- 页面标题含"母公司"或"本部" → scope="parent"
- 无明确标注 → scope="consolidated"

【第二步】识别报表类型（stmt）：
- 含"货币资金"/"应收账款"/"固定资产"/"资产总计"/"负债合计" → stmt="balance_sheet"
- 含"营业收入"/"营业成本"/"净利润"/"归属于母公司股东" → stmt="income"
- 含"经营活动产生"/"投资活动产生"/"筹资活动产生"/"现金及现金等价物" → stmt="cash_flow"
- 不属于以上任何报表 → stmt="other"

type字段 = stmt + "_" + scope（当stmt为"other"时type="other"）
示例："balance_sheet_consolidated" / "income_parent" / "cash_flow_consolidated"

JSON格式：
{"type":"...","year":年份整数,"prev_year":上年整数,"unit":"元或万元","items":[{"name":"科目","current":数字或null,"prev":数字或null,"type":"total/subtotal/header/detail"}]}

规则：
- year/prev_year：从表头"xxxx年12月31日"/"xxxx年度"识别报告期年份；扫描误读时从数值量级推断
- unit：从表头"单位：元"/"金额单位：元"/"单位：万元"识别
- item.type：total=资产总计/净利润/现金净增加额等最终汇总行，subtotal=小计/合计，header=流动资产/经营活动等章节标题（无数值），detail=明细科目
- 金额去千分位逗号，负数加"-"
- 不要遗漏任何有数值的行"""


def _to_wan(value, unit: str):
    if value is None:
        return None
    v = float(value)
    if unit == "元":
        v = v / 10000
    elif unit == "亿元":
        v = v * 10000
    return round(v, 2)


# ── 标准科目模板 ──────────────────────────────────────────────────────────────
def _r(name, t):
    return {"name": name, "type": t}

_H, _D, _S, _T = "header", "detail", "subtotal", "total"

_BS_TMPL_COMMON_ASSETS = [
    _r("流动资产",                    _H),
    _r("货币资金",                    _D),
    _r("交易性金融资产",               _D),
    _r("衍生金融资产",                 _D),
    _r("应收票据",                    _D),
    _r("应收账款",                    _D),
    _r("应收款项融资",                 _D),
    _r("预付款项",                    _D),
    _r("其他应收款",                   _D),
    _r("存货",                        _D),
    _r("合同资产",                    _D),
    _r("持有待售资产",                 _D),
    _r("一年内到期的非流动资产",        _D),
    _r("其他流动资产",                 _D),
    _r("流动资产合计",                 _S),
    _r("非流动资产",                   _H),
    _r("债权投资",                    _D),
    _r("其他债权投资",                 _D),
    _r("长期应收款",                   _D),
    _r("长期股权投资",                 _D),
    _r("其他权益工具投资",              _D),
    _r("其他非流动金融资产",            _D),
    _r("投资性房地产",                 _D),
    _r("固定资产",                    _D),
    _r("在建工程",                    _D),
    _r("使用权资产",                   _D),
    _r("无形资产",                    _D),
    _r("开发支出",                    _D),
    _r("商誉",                        _D),
    _r("长期待摊费用",                 _D),
    _r("递延所得税资产",               _D),
    _r("其他非流动资产",               _D),
    _r("非流动资产合计",               _S),
    _r("资产总计",                    _T),
]

_BS_TMPL_COMMON_LIAB = [
    _r("流动负债",                    _H),
    _r("短期借款",                    _D),
    _r("交易性金融负债",               _D),
    _r("衍生金融负债",                 _D),
    _r("应付票据",                    _D),
    _r("应付账款",                    _D),
    _r("预收款项",                    _D),
    _r("合同负债",                    _D),
    _r("应付职工薪酬",                 _D),
    _r("应交税费",                    _D),
    _r("其他应付款",                   _D),
    _r("持有待售负债",                 _D),
    _r("一年内到期的非流动负债",        _D),
    _r("其他流动负债",                 _D),
    _r("流动负债合计",                 _S),
    _r("非流动负债",                   _H),
    _r("长期借款",                    _D),
    _r("应付债券",                    _D),
    _r("租赁负债",                    _D),
    _r("长期应付款",                   _D),
    _r("预计负债",                    _D),
    _r("递延收益",                    _D),
    _r("递延所得税负债",               _D),
    _r("其他非流动负债",               _D),
    _r("非流动负债合计",               _S),
    _r("负债合计",                    _T),
]

BS_CONSOL_TMPL = _BS_TMPL_COMMON_ASSETS + _BS_TMPL_COMMON_LIAB + [
    _r("所有者权益",                   _H),
    _r("股本",                        _D),
    _r("其他权益工具",                 _D),
    _r("资本公积",                    _D),
    _r("减：库存股",                   _D),
    _r("其他综合收益",                 _D),
    _r("专项储备",                    _D),
    _r("盈余公积",                    _D),
    _r("未分配利润",                   _D),
    _r("归属于母公司所有者权益合计",    _S),
    _r("少数股东权益",                 _D),
    _r("所有者权益合计",               _T),
    _r("负债和所有者权益总计",          _T),
]

BS_PARENT_TMPL = _BS_TMPL_COMMON_ASSETS + _BS_TMPL_COMMON_LIAB + [
    _r("所有者权益",                   _H),
    _r("股本",                        _D),
    _r("其他权益工具",                 _D),
    _r("资本公积",                    _D),
    _r("减：库存股",                   _D),
    _r("其他综合收益",                 _D),
    _r("专项储备",                    _D),
    _r("盈余公积",                    _D),
    _r("未分配利润",                   _D),
    _r("所有者权益合计",               _T),
    _r("负债和所有者权益总计",          _T),
]

INC_CONSOL_TMPL = [
    _r("营业收入",                    _T),
    _r("营业成本",                    _D),
    _r("税金及附加",                   _D),
    _r("销售费用",                    _D),
    _r("管理费用",                    _D),
    _r("研发费用",                    _D),
    _r("财务费用",                    _D),
    _r("其他收益",                    _D),
    _r("投资收益",                    _D),
    _r("公允价值变动收益",              _D),
    _r("信用减值损失",                 _D),
    _r("资产减值损失",                 _D),
    _r("资产处置收益",                 _D),
    _r("营业利润",                    _S),
    _r("营业外收入",                   _D),
    _r("营业外支出",                   _D),
    _r("利润总额",                    _S),
    _r("所得税费用",                   _D),
    _r("净利润",                      _T),
    _r("归属于母公司所有者的净利润",    _D),
    _r("少数股东损益",                 _D),
    _r("其他综合收益的税后净额",        _S),
    _r("综合收益总额",                 _T),
    _r("归属于母公司所有者的综合收益总额", _D),
    _r("归属于少数股东的综合收益总额",  _D),
    _r("基本每股收益",                 _D),
    _r("稀释每股收益",                 _D),
]

INC_PARENT_TMPL = [
    _r("营业收入",                    _T),
    _r("营业成本",                    _D),
    _r("税金及附加",                   _D),
    _r("销售费用",                    _D),
    _r("管理费用",                    _D),
    _r("研发费用",                    _D),
    _r("财务费用",                    _D),
    _r("其他收益",                    _D),
    _r("投资收益",                    _D),
    _r("公允价值变动收益",              _D),
    _r("信用减值损失",                 _D),
    _r("资产减值损失",                 _D),
    _r("资产处置收益",                 _D),
    _r("营业利润",                    _S),
    _r("营业外收入",                   _D),
    _r("营业外支出",                   _D),
    _r("利润总额",                    _S),
    _r("所得税费用",                   _D),
    _r("净利润",                      _T),
    _r("其他综合收益的税后净额",        _S),
    _r("综合收益总额",                 _T),
    _r("基本每股收益",                 _D),
    _r("稀释每股收益",                 _D),
]

CF_TMPL = [
    _r("经营活动产生的现金流量",                       _H),
    _r("销售商品、提供劳务收到的现金",                  _D),
    _r("收到的税费返还",                               _D),
    _r("收到其他与经营活动有关的现金",                  _D),
    _r("经营活动现金流入小计",                          _S),
    _r("购买商品、接受劳务支付的现金",                  _D),
    _r("支付给职工以及为职工支付的现金",                 _D),
    _r("支付的各项税费",                               _D),
    _r("支付其他与经营活动有关的现金",                  _D),
    _r("经营活动现金流出小计",                          _S),
    _r("经营活动产生的现金流量净额",                    _T),
    _r("投资活动产生的现金流量",                        _H),
    _r("收回投资收到的现金",                            _D),
    _r("取得投资收益收到的现金",                        _D),
    _r("处置固定资产等收回的现金净额",                  _D),
    _r("处置子公司及其他营业单位收到的现金净额",         _D),
    _r("收到其他与投资活动有关的现金",                  _D),
    _r("投资活动现金流入小计",                          _S),
    _r("购建固定资产、无形资产支付的现金",               _D),
    _r("投资支付的现金",                               _D),
    _r("取得子公司及其他营业单位支付的现金净额",         _D),
    _r("支付其他与投资活动有关的现金",                  _D),
    _r("投资活动现金流出小计",                          _S),
    _r("投资活动产生的现金流量净额",                    _T),
    _r("筹资活动产生的现金流量",                        _H),
    _r("吸收投资收到的现金",                            _D),
    _r("取得借款收到的现金",                            _D),
    _r("收到其他与筹资活动有关的现金",                  _D),
    _r("筹资活动现金流入小计",                          _S),
    _r("偿还债务支付的现金",                            _D),
    _r("分配股利、利润或偿付利息支付的现金",             _D),
    _r("支付其他与筹资活动有关的现金",                  _D),
    _r("筹资活动现金流出小计",                          _S),
    _r("筹资活动产生的现金流量净额",                    _T),
    _r("汇率变动对现金及现金等价物的影响",               _D),
    _r("现金及现金等价物净增加额",                      _T),
    _r("期初现金及现金等价物余额",                      _D),
    _r("期末现金及现金等价物余额",                      _T),
]

# 科目名称常见变体 → 标准名称
_NAME_ALIASES = {
    "资产合计": "资产总计",
    "负债和所有者权益合计": "负债和所有者权益总计",
    "负债及所有者权益总计": "负债和所有者权益总计",
    "归属于母公司股东的净利润": "归属于母公司所有者的净利润",
    "归属于母公司股东的综合收益总额": "归属于母公司所有者的综合收益总额",
    "归属于少数股东的净利润": "少数股东损益",
    "经营活动净现金流量": "经营活动产生的现金流量净额",
    "投资活动净现金流量": "投资活动产生的现金流量净额",
    "筹资活动净现金流量": "筹资活动产生的现金流量净额",
    "处置固定资产、无形资产和其他长期资产收回的现金净额": "处置固定资产等收回的现金净额",
    "购建固定资产、无形资产和其他长期资产支付的现金": "购建固定资产、无形资产支付的现金",
    "母公司所有者权益合计": "所有者权益合计",
}

import re as _re_fin


def _norm(name: str) -> str:
    """去掉编号前缀（一、二. 1. （一）等）和后缀括号注释，归一化空格"""
    n = _re_fin.sub(r'^[\s]*[（(]?[一二三四五六七八九十百\d]+[）)]?[、。.：: ]+', '', name)
    n = _re_fin.sub(r'[（(][^（()]{1,10}[）)]$', '', n)
    return n.strip()


def _apply_template(raw_items: list, template: list) -> list:
    """将AI提取的科目映射到标准模板，未匹配的科目追加到末尾"""
    # 构建多键查找表：原始名 / 规范名 / 别名目标 → item
    lookup: dict = {}
    for it in raw_items:
        nm = it.get("name", "").strip()
        if not nm:
            continue
        lookup[nm] = it
        nrm = _norm(nm)
        if nrm != nm:
            lookup[nrm] = it
        # 正向别名：提取名是源，别名目标作 key
        alias_target = _NAME_ALIASES.get(nm) or _NAME_ALIASES.get(nrm)
        if alias_target:
            lookup[alias_target] = it
        # 反向别名：提取名是别名目标时，也能被模板中的源名找到
        # （此处不需要反查，因为模板 key 已是标准名）

    tmpl_norms = {_norm(r["name"]) for r in template}
    matched_raw_names: set = set()
    result = []

    for row in template:
        key = row["name"]
        match = lookup.get(key) or lookup.get(_norm(key))
        if match:
            matched_raw_names.add(match.get("name", ""))
            result.append({"name": key, "current": match.get("current"),
                           "prev": match.get("prev"), "type": row["type"]})
        else:
            result.append({"name": key, "current": None, "prev": None, "type": row["type"]})

    # 未匹配的非 header 科目追加到末尾
    for it in raw_items:
        nm = it.get("name", "").strip()
        if nm and nm not in matched_raw_names and _norm(nm) not in tmpl_norms:
            if it.get("type") != "header":
                result.append({"name": nm, "current": it.get("current"),
                               "prev": it.get("prev"), "type": it.get("type", "detail")})
    return result


_TMPL_MAP = {
    "balance_sheet":          BS_CONSOL_TMPL,
    "balance_sheet_parent":   BS_PARENT_TMPL,
    "income":                 INC_CONSOL_TMPL,
    "income_parent":          INC_PARENT_TMPL,
    "cash_flow_consolidated": CF_TMPL,
    "cash_flow_parent":       CF_TMPL,
}


_STMT_KEYS = {
    "balance_sheet_consolidated": "balance_sheet",
    "balance_sheet_parent":       "balance_sheet_parent",
    "income_consolidated":        "income",
    "income_parent":              "income_parent",
    "cash_flow_consolidated":     "cash_flow_consolidated",
    "cash_flow_parent":           "cash_flow_parent",
}
_FIN_KEYWORDS = [
    "资产负债表", "利润表", "现金流量表",
    "货币资金", "营业收入", "资产总计",
    "经营活动产生", "投资活动产生", "筹资活动产生",
    "母公司资产负债", "母公司利润", "母公司现金",
]


def _read_xlsx_sheets(file_path: Path) -> dict:
    """Return {sheet_name: [[cell_value, ...]]} for all sheets in an xlsx/xlsm file."""
    import openpyxl
    wb = openpyxl.load_workbook(str(file_path), data_only=True)
    sheets = {}
    for ws in wb.worksheets:
        # Unmerge: fill merged regions with top-left value
        merge_map = {}
        for rng in list(ws.merged_cells.ranges):
            top_val = ws.cell(rng.min_row, rng.min_col).value
            for r in range(rng.min_row, rng.max_row + 1):
                for c in range(rng.min_col, rng.max_col + 1):
                    if (r, c) != (rng.min_row, rng.min_col):
                        merge_map[(r, c)] = top_val
        rows = []
        for r_idx, row in enumerate(ws.iter_rows(), start=1):
            cells = []
            for c_idx, cell in enumerate(row, start=1):
                val = merge_map.get((r_idx, c_idx), cell.value)
                cells.append(val)
            rows.append(cells)
        sheets[ws.title] = rows
    return sheets


def _read_xls_sheets(file_path: Path) -> dict:
    """Return {sheet_name: [[cell_value, ...]]} for all sheets in an xls file."""
    import xlrd
    wb = xlrd.open_workbook(str(file_path))
    sheets = {}
    for ws in wb.sheets():
        rows = []
        for r in range(ws.nrows):
            cells = []
            for c in range(ws.ncols):
                cell = ws.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_EMPTY:
                    cells.append(None)
                elif cell.ctype == xlrd.XL_CELL_NUMBER:
                    v = cell.value
                    cells.append(int(v) if v == int(v) else v)
                else:
                    cells.append(cell.value)
            rows.append(cells)
        sheets[ws.name] = rows
    return sheets


def _parse_fin_sheet(rows: list) -> tuple:
    """
    Parse a 2-D table of cells into a list of financial items.
    Returns (items, unit, year_label, prev_year_label).
    items = [{"name": str, "current": float|None, "prev": float|None, "type": str}]
    """
    import re

    unit = "元"
    year_cur = ""
    year_prev = ""

    # Detect unit in first 10 rows
    for row in rows[:10]:
        for cell in row:
            s = str(cell or "")
            if "万元" in s:
                unit = "万元"
            elif "千元" in s or "千" in s:
                unit = "千元"

    # Detect name column and year columns by scanning header rows
    name_col = 0
    cur_col = None
    prev_col = None

    for row in rows[:15]:
        str_cells = [str(c or "").strip() for c in row]
        # Look for a row that contains year patterns like 2023, 2022
        years = [(i, s) for i, s in enumerate(str_cells)
                 if re.search(r'20\d{2}', s) and i > 0]
        if len(years) >= 2:
            cur_col = years[0][0]
            prev_col = years[1][0]
            year_cur = re.search(r'20\d{2}', years[0][1]).group()
            year_prev = re.search(r'20\d{2}', years[1][1]).group()
            break
        if len(years) == 1:
            cur_col = years[0][0]
            year_cur = re.search(r'20\d{2}', years[0][1]).group()

    if cur_col is None:
        # Fallback: take last two non-empty numeric columns
        for row in rows[:20]:
            num_cols = [i for i, c in enumerate(row) if isinstance(c, (int, float)) and i > 0]
            if len(num_cols) >= 2:
                cur_col = num_cols[0]
                prev_col = num_cols[1]
                break
        if cur_col is None:
            return [], unit, year_cur, year_prev

    def _to_float(v):
        if v is None:
            return None
        try:
            f = float(str(v).replace(",", "").replace("，", "").strip())
            return None if f == 0 else f
        except Exception:
            return None

    items = []
    for row in rows:
        if not row:
            continue
        name_raw = str(row[name_col] or "").strip()
        if not name_raw or len(name_raw) < 2:
            continue
        # Skip obvious header/unit rows
        if re.search(r'单位|编制|报告期|项\s*目|科\s*目|说明|附注|年度', name_raw):
            continue
        cur_val = _to_float(row[cur_col]) if cur_col < len(row) else None
        prev_val = _to_float(row[prev_col]) if prev_col is not None and prev_col < len(row) else None
        # Classify row type
        row_type = "detail"
        if re.search(r'合计|总计|净额|净利润|净增加', name_raw):
            row_type = "total"
        elif re.search(r'小计', name_raw):
            row_type = "subtotal"
        items.append({"name": name_raw, "current": cur_val, "prev": prev_val, "type": row_type})

    return items, unit, year_cur, year_prev


# Keywords used to identify which of the 6 statement types a sheet represents
_SHEET_TYPE_RULES = [
    ("cash_flow_consolidated", ["现金流量", "合并现金", "现金及现金等价物"]),
    ("cash_flow_parent",       ["母公司现金流量", "本公司现金流量"]),
    ("balance_sheet",          ["合并资产负债", "合并负债"]),
    ("balance_sheet_parent",   ["母公司资产负债", "本公司资产负债"]),
    ("income",                 ["合并利润", "合并损益"]),
    ("income_parent",          ["母公司利润", "本公司利润", "母公司损益"]),
]
_SHEET_GENERIC_RULES = [
    ("cash_flow_consolidated", ["现金流量"]),
    ("balance_sheet",          ["资产负债"]),
    ("income",                 ["利润", "损益"]),
]


def _classify_sheet(sheet_name: str) -> Optional[str]:
    name = sheet_name.strip()
    for key, kws in _SHEET_TYPE_RULES:
        if any(kw in name for kw in kws):
            return key
    for key, kws in _SHEET_GENERIC_RULES:
        if any(kw in name for kw in kws):
            return key
    return None


def _extract_excel(file_path: Path) -> dict:
    """Parse financial Excel file and return same dict structure as _extract_pages_vision."""
    suffix = file_path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        sheets = _read_xlsx_sheets(file_path)
    else:
        sheets = _read_xls_sheets(file_path)

    result = {k: [] for k in _TMPL_MAP}
    result["unit"] = "万元"

    assigned = set()
    for sheet_name, rows in sheets.items():
        key = _classify_sheet(sheet_name)
        if key is None or key in assigned:
            continue
        items, unit, _y, _py = _parse_fin_sheet(rows)
        if not items:
            continue

        def _to_wan(v, u):
            if v is None:
                return None
            if u == "元":
                return round(v / 10000, 4)
            if u == "千元":
                return round(v / 10, 4)
            return v

        converted = [
            {
                "name":    it["name"],
                "current": _to_wan(it["current"], unit),
                "prev":    _to_wan(it["prev"],    unit),
                "type":    it["type"],
            }
            for it in items if it.get("name")
        ]
        result[key].extend(converted)
        assigned.add(key)
        print(f"Excel sheet '{sheet_name}' → {key}: {len(converted)} rows")

    # Map raw items to standard templates
    for key, tmpl in _TMPL_MAP.items():
        result[key] = _apply_template(result[key], tmpl)
    return result


async def _extract_pages_vision(pdf_path: Path) -> dict:
    """把PDF各页转图片，用视觉AI提取财务报表（合并+本部×3表）"""
    import fitz, base64 as _b64, re as _re
    from openai import OpenAI

    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    base_url = os.getenv("DEEPSEEK_BASE_URL", "").rstrip("/")
    client = OpenAI(api_key=api_key, base_url=base_url)

    pdf = fitz.open(str(pdf_path))
    total = len(pdf)

    # 扫文字层找候选页（最多扫60页），无命中则兜底用5-35页
    candidate_pages = []
    for i in range(min(60, total)):
        txt = pdf[i].get_text() or ""
        if any(k in txt for k in _FIN_KEYWORDS):
            candidate_pages.append(i)
    if not candidate_pages:
        candidate_pages = list(range(5, min(36, total)))

    result = {"year": None, "prev_year": None, "unit": "元",
              "balance_sheet": [], "income": [],
              "balance_sheet_parent": [], "income_parent": [],
              "cash_flow_consolidated": [], "cash_flow_parent": []}

    for idx in candidate_pages:
        page = pdf[idx]
        mat = fitz.Matrix(1.5, 1.5)
        pix = page.get_pixmap(matrix=mat)
        b64 = _b64.b64encode(pix.tobytes("png")).decode()

        try:
            resp = client.chat.completions.create(
                model=VISION_MODEL,
                messages=[{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": _FIN_PROMPT},
                ]}],
                max_tokens=6000,
            )
            raw = resp.choices[0].message.content
            finish = resp.choices[0].finish_reason
            m = _re.search(r'\{[\s\S]*', raw)
            if not m:
                print(f"Page {idx+1}: no JSON in response, skip")
                continue
            fragment = m.group()
            # 截断时修补残缺 JSON：找最后一个完整 item 的 }，补上 ]}
            if finish == "length":
                last_close = fragment.rfind('},')
                if last_close == -1:
                    last_close = fragment.rfind('}')
                if last_close != -1:
                    fragment = fragment[:last_close + 1] + "\n  ]\n}"
                    print(f"Page {idx+1}: truncated, salvaged up to char {last_close}")
                else:
                    print(f"Page {idx+1}: truncated and unsalvageable, skip")
                    continue
            # 确保末尾有完整 }
            if not fragment.rstrip().endswith('}'):
                last_close = fragment.rfind('}')
                fragment = fragment[:last_close + 1] if last_close != -1 else fragment
            page_data = json.loads(fragment)
        except json.JSONDecodeError as e:
            print(f"Page {idx+1}: JSON parse error: {e} — raw[:200]: {raw[:200]}")
            continue
        except Exception as e:
            print(f"Vision page {idx+1} error: {e}")
            continue

        ptype = page_data.get("type", "other")
        if ptype == "other":
            continue

        # 记录年份和单位（取第一个有效值）
        if not result["year"] and page_data.get("year"):
            result["year"] = page_data["year"]
            result["prev_year"] = page_data.get("prev_year")
        if page_data.get("unit"):
            result["unit"] = page_data["unit"]

        items = page_data.get("items", [])
        converted = [
            {
                "name": it.get("name", ""),
                "current": _to_wan(it.get("current"), page_data.get("unit", "元")),
                "prev":    _to_wan(it.get("prev"),    page_data.get("unit", "元")),
                "type":    it.get("type", "detail"),
            }
            for it in items if it.get("name")
        ]

        dest_key = _STMT_KEYS.get(ptype)
        if dest_key:
            result[dest_key].extend(converted)
            print(f"Page {idx+1}: {ptype} → {len(converted)} rows")

    pdf.close()
    result["unit"] = "万元"
    # 将原始科目列表映射到标准模板
    for key, tmpl in _TMPL_MAP.items():
        result[key] = _apply_template(result[key], tmpl)
    return result


@app.post("/api/companies/{company_id}/financials/extract")
async def extract_financial(company_id: int):
    conn = get_db()
    doc = conn.execute(
        """SELECT * FROM documents WHERE company_id=?
           AND (
             lower(original_name) LIKE '%.pdf'
             OR lower(original_name) LIKE '%.xlsx'
             OR lower(original_name) LIKE '%.xls'
             OR lower(original_name) LIKE '%.xlsm'
           )
           ORDER BY
             CASE WHEN category='财务状况' THEN 0
                  WHEN original_name LIKE '%审计%' THEN 1
                  WHEN original_name LIKE '%财务%' THEN 2
                  ELSE 3 END,
             uploaded_at DESC
           LIMIT 1""",
        (company_id,),
    ).fetchone()
    conn.close()

    if not doc:
        raise HTTPException(400, "未找到可提取的文档，请先上传审计报告（PDF）或财务报表（Excel）")

    file_path = UPLOAD_DIR / doc["filename"]
    if not file_path.exists():
        raise HTTPException(400, "文档文件不存在，请重新上传")

    suffix = Path(doc["original_name"]).suffix.lower()
    is_excel = suffix in (".xlsx", ".xls", ".xlsm")

    try:
        if is_excel:
            result = _extract_excel(file_path)
        else:
            api_key = os.getenv("DEEPSEEK_API_KEY", "")
            base_url = os.getenv("DEEPSEEK_BASE_URL", "")
            if not api_key or "moonshot" not in base_url:
                raise HTTPException(400, "需要配置 Kimi（Moonshot）云端 API 才能提取扫描件PDF")
            result = await _extract_pages_vision(file_path)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"提取失败：{e}")

    if not any(result[k] for k in ("balance_sheet", "income", "balance_sheet_parent",
                                    "income_parent", "cash_flow_consolidated", "cash_flow_parent")):
        raise HTTPException(400, "未识别到财务报表，请确认文档包含资产负债表、利润表或现金流量表")

    result["source_doc"] = doc["original_name"]
    return result


# ── iCal Calendar Feed ───────────────────────────────────────────────────────

@app.get("/api/calendar/todos.ics")
def calendar_todos(token: str = ""):
    if ACCESS_PASSWORD and token != ACCESS_PASSWORD:
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse("Unauthorized", status_code=401)

    from datetime import date, timedelta
    conn = get_db()
    rows = conn.execute(
        """SELECT t.*, co.name as company_name
           FROM todos t LEFT JOIN companies co ON t.company_id=co.id
           WHERE t.done=0 ORDER BY t.date"""
    ).fetchall()
    conn.close()

    def ics_date(d: str) -> str:
        return d.replace("-", "")

    def ics_date_next(d: str) -> str:
        return (date.fromisoformat(d) + timedelta(days=1)).strftime("%Y%m%d")

    priority_map = {"high": "1", "medium": "5", "low": "9"}
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//客户档案系统//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:客户待办事项",
        "X-WR-CALDESC:银行客户经理待办",
        "X-WR-TIMEZONE:Asia/Shanghai",
    ]

    for r in rows:
        t = dict(r)
        uid = f"todo-{t['id']}@client-manager"
        start = ics_date(t["date"])
        end = ics_date_next(t.get("end_date") or t["date"])
        summary = t["content"]
        if t.get("company_name"):
            summary = f"[{t['company_name']}] {summary}"
        desc_parts = []
        if t.get("company_name"):
            desc_parts.append(f"客户：{t['company_name']}")
        prio_label = {"high": "高优先级", "medium": "中优先级", "low": "低优先级"}.get(t.get("priority","medium"), "")
        if prio_label:
            desc_parts.append(prio_label)
        if t.get("end_date"):
            desc_parts.append(f"截止：{t['end_date']}")
        desc = "\\n".join(desc_parts)
        prio = priority_map.get(t.get("priority", "medium"), "5")

        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTART;VALUE=DATE:{start}",
            f"DTEND;VALUE=DATE:{end}",
            f"SUMMARY:{summary}",
            f"DESCRIPTION:{desc}",
            f"PRIORITY:{prio}",
            "STATUS:NEEDS-ACTION",
            "END:VEVENT",
        ]

    lines.append("END:VCALENDAR")
    ics_content = "\r\n".join(lines) + "\r\n"

    from fastapi.responses import Response
    return Response(
        content=ics_content,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=todos.ics"},
    )


# ── Static ────────────────────────────────────────────────────────────────────

app.mount("/", StaticFiles(directory="static", html=True), name="static")


@app.on_event("startup")
def on_startup():
    init_db()
    init_vapid()
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
        scheduler.add_job(send_daily_push, CronTrigger(hour=8, minute=0))
        scheduler.start()
        app.state.scheduler = scheduler
        print("✅ 每日推送已调度（08:00 Asia/Shanghai）")
    except Exception as e:
        print(f"⚠️  调度器启动失败：{e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
