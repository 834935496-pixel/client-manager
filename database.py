import sqlite3
import json

DB_PATH = "client_manager.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            industry TEXT DEFAULT '',
            level TEXT DEFAULT 'B',
            credit_limit REAL DEFAULT 0,
            products TEXT DEFAULT '[]',
            tags TEXT DEFAULT '[]',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            position TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            wechat TEXT DEFAULT '',
            email TEXT DEFAULT '',
            is_primary INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            contact_id INTEGER,
            date TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            next_action TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
            FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            contact_id INTEGER,
            date TEXT NOT NULL,
            content TEXT NOT NULL,
            priority TEXT DEFAULT 'medium',
            done INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
            FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
        CREATE INDEX IF NOT EXISTS idx_interactions_company ON interactions(company_id);
        CREATE INDEX IF NOT EXISTS idx_interactions_date ON interactions(date);
        CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date);
        CREATE INDEX IF NOT EXISTS idx_todos_company ON todos(company_id);

        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            category TEXT DEFAULT '其他',
            description TEXT DEFAULT '',
            uploaded_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);

        CREATE TABLE IF NOT EXISTS company_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            category TEXT NOT NULL DEFAULT '资产类',
            product_name TEXT NOT NULL,
            amount REAL DEFAULT 0,
            start_date TEXT DEFAULT '',
            end_date TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_company_products_company ON company_products(company_id);
        CREATE INDEX IF NOT EXISTS idx_company_products_end ON company_products(end_date);

        CREATE TABLE IF NOT EXISTS todo_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            todo_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            uploaded_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_todo_documents_todo ON todo_documents(todo_id);

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS company_financials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            year INTEGER NOT NULL,
            unit TEXT DEFAULT '万元',
            balance_sheet TEXT DEFAULT '[]',
            income TEXT DEFAULT '[]',
            source_doc TEXT DEFAULT '',
            extracted_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
            UNIQUE(company_id, year)
        );
        CREATE INDEX IF NOT EXISTS idx_financials_company ON company_financials(company_id);
    """)
    conn.commit()
    _migrate_if_needed(conn)
    _add_company_ext_fields(conn)
    _add_doc_index_fields(conn)
    _init_credit_lines(conn)
    _init_post_loan_checks(conn)
    conn.close()


def _add_company_ext_fields(conn):
    existing = {r[1] for r in conn.execute("PRAGMA table_info(companies)").fetchall()}
    new_cols = [
        ("legal_rep",        "TEXT DEFAULT ''"),
        ("legal_rep_id",     "TEXT DEFAULT ''"),
        ("credit_code",      "TEXT DEFAULT ''"),
        ("reg_capital",      "TEXT DEFAULT ''"),
        ("established_date", "TEXT DEFAULT ''"),
        ("reg_address",      "TEXT DEFAULT ''"),
        ("biz_scope",        "TEXT DEFAULT ''"),
        ("company_scale",         "TEXT DEFAULT ''"),
        ("office_address",        "TEXT DEFAULT ''"),
        ("employee_count",        "TEXT DEFAULT ''"),
        ("operating_scope",       "TEXT DEFAULT ''"),
    ]
    for col, defn in new_cols:
        if col not in existing:
            conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {defn}")

    # 业务阶段 + 最近拜访日期
    existing = {r[1] for r in conn.execute("PRAGMA table_info(companies)").fetchall()}
    for col, defn in [
        ("business_stage", "TEXT DEFAULT '意向客户'"),
        ("last_visit_date", "TEXT DEFAULT ''"),
    ]:
        if col not in existing:
            conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {defn}")

    # todos 子项迁移
    todo_cols = {r[1] for r in conn.execute("PRAGMA table_info(todos)").fetchall()}
    if "sub_items" not in todo_cols:
        conn.execute("ALTER TABLE todos ADD COLUMN sub_items TEXT DEFAULT '[]'")
    if "end_date" not in todo_cols:
        conn.execute("ALTER TABLE todos ADD COLUMN end_date TEXT DEFAULT ''")

    # company_products 资产类细化
    prod_cols = {r[1] for r in conn.execute("PRAGMA table_info(company_products)").fetchall()}
    if prod_cols:  # 表已存在才迁移
        if "credit_type" not in prod_cols:
            conn.execute("ALTER TABLE company_products ADD COLUMN credit_type TEXT DEFAULT ''")
        if "loan_amount" not in prod_cols:
            conn.execute("ALTER TABLE company_products ADD COLUMN loan_amount REAL DEFAULT 0")

    # 股权图缓存字段
    existing = {r[1] for r in conn.execute("PRAGMA table_info(companies)").fetchall()}
    for col, defn in [("equity_data", "TEXT"), ("equity_updated_at", "TEXT DEFAULT ''")]:
        if col not in existing:
            conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {defn}")

    # 恢复 companies 剩余字段
    existing = {r[1] for r in conn.execute("PRAGMA table_info(companies)").fetchall()}
    new_cols = [
        ("products_assets",       "TEXT DEFAULT '[]'"),
        ("products_liabilities",  "TEXT DEFAULT '[]'"),
        ("products_intermediary", "TEXT DEFAULT '[]'"),
    ]
    for col, defn in new_cols:
        if col not in existing:
            conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {defn}")

    # company_financials 扩展：本部报表 + 现金流量表
    fin_cols = {r[1] for r in conn.execute("PRAGMA table_info(company_financials)").fetchall()}
    fin_new = [
        ("balance_sheet_parent",   "TEXT DEFAULT '[]'"),
        ("income_parent",          "TEXT DEFAULT '[]'"),
        ("cash_flow_consolidated", "TEXT DEFAULT '[]'"),
        ("cash_flow_parent",       "TEXT DEFAULT '[]'"),
    ]
    for col, defn in fin_new:
        if col not in fin_cols:
            conn.execute(f"ALTER TABLE company_financials ADD COLUMN {col} {defn}")
    conn.commit()


def _init_credit_lines(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS credit_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            credit_type TEXT DEFAULT '',
            credit_amount REAL DEFAULT 0,
            used_amount REAL DEFAULT 0,
            interest_rate TEXT DEFAULT '',
            guarantee_type TEXT DEFAULT '',
            start_date TEXT DEFAULT '',
            end_date TEXT DEFAULT '',
            status TEXT DEFAULT '正常',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_credit_lines_company ON credit_lines(company_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_credit_lines_end ON credit_lines(end_date)")
    conn.commit()


def _init_post_loan_checks(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS post_loan_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            check_date TEXT NOT NULL,
            check_type TEXT DEFAULT '日常检查',
            risk_level TEXT DEFAULT '正常',
            inspector TEXT DEFAULT '',
            content TEXT DEFAULT '',
            issues TEXT DEFAULT '',
            measures TEXT DEFAULT '',
            next_check_date TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_post_loan_company ON post_loan_checks(company_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_post_loan_date ON post_loan_checks(check_date)")
    conn.commit()


def _add_doc_index_fields(conn):
    doc_cols = {r[1] for r in conn.execute("PRAGMA table_info(documents)").fetchall()}
    if "doc_text" not in doc_cols:
        conn.execute("ALTER TABLE documents ADD COLUMN doc_text TEXT DEFAULT ''")
    if "doc_indexed" not in doc_cols:
        conn.execute("ALTER TABLE documents ADD COLUMN doc_indexed INTEGER DEFAULT 0")
    # FTS5 全文检索表（每个文档对应一行）
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            original_name,
            doc_text,
            tokenize='unicode61'
        )
    """)
    conn.commit()


def _migrate_if_needed(conn):
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}

    if "clients" not in tables or "companies" in tables:
        return

    conn.execute("PRAGMA foreign_keys=OFF")

    # clients → companies（公司信息）
    conn.execute("""
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            industry TEXT DEFAULT '',
            level TEXT DEFAULT 'B',
            credit_limit REAL DEFAULT 0,
            products TEXT DEFAULT '[]',
            tags TEXT DEFAULT '[]',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    conn.execute("""
        INSERT INTO companies (id, name, industry, level, credit_limit, products, tags, notes, created_at, updated_at)
        SELECT id, company, industry, level, credit_limit, products, tags, notes, created_at, updated_at
        FROM clients
    """)

    # clients → contacts（联系人）
    conn.execute("""
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            position TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            wechat TEXT DEFAULT '',
            email TEXT DEFAULT '',
            is_primary INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        INSERT INTO contacts (company_id, name, position, phone, wechat, email, is_primary, created_at)
        SELECT id, name, position, phone, wechat, email, 1, created_at
        FROM clients
    """)

    # interactions：client_id → company_id
    if "interactions" in tables:
        conn.execute("""
            CREATE TABLE interactions_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                contact_id INTEGER,
                date TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                next_action TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
            )
        """)
        conn.execute("""
            INSERT INTO interactions_new (id, company_id, date, type, content, next_action, created_at)
            SELECT id, client_id, date, type, content, next_action, created_at FROM interactions
        """)
        conn.execute("DROP TABLE interactions")
        conn.execute("ALTER TABLE interactions_new RENAME TO interactions")

    # todos：client_id → company_id
    if "todos" in tables:
        conn.execute("""
            CREATE TABLE todos_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER,
                contact_id INTEGER,
                date TEXT NOT NULL,
                content TEXT NOT NULL,
                priority TEXT DEFAULT 'medium',
                done INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
                FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
            )
        """)
        conn.execute("""
            INSERT INTO todos_new (id, company_id, date, content, priority, done, created_at)
            SELECT id, client_id, date, content, priority, done, created_at FROM todos
        """)
        conn.execute("DROP TABLE todos")
        conn.execute("ALTER TABLE todos_new RENAME TO todos")

    conn.execute("DROP TABLE clients")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.commit()
    print("✅ 数据已从旧格式迁移完成（客户 → 公司+联系人）")


def row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    for field in ("products", "tags", "products_assets", "products_liabilities", "products_intermediary"):
        if field in d and isinstance(d[field], str):
            try:
                d[field] = json.loads(d[field])
            except Exception:
                d[field] = []
    return d
