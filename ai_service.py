import os
import httpx
from openai import OpenAI

FAST_MODEL = "qwen2.5:14b"
DEEP_MODEL = "qwen2.5:72b-128k"

_no_proxy_transport = httpx.HTTPTransport(proxy=None)
_local_http_client = httpx.Client(transport=_no_proxy_transport, timeout=120)

local_client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama",
    http_client=_local_http_client,
)


def get_cloud_client():
    return OpenAI(
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        api_key=os.getenv("DEEPSEEK_API_KEY", ""),
    )


SYSTEM_PROMPT = """你是一位银行对公业务AI助理，协助客户经理管理企业客户关系。
你熟悉银行对公业务，包括授信、贷款、存款、结算、理财等产品。
回答时简洁专业，直接给出可操作的建议。
如需分析客户，优先基于提供的企业档案数据。"""


def chat(messages: list, mode: str = "fast") -> str:
    system = {"role": "system", "content": SYSTEM_PROMPT}
    full_messages = [system] + messages

    if mode == "cloud":
        client = get_cloud_client()
        model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        resp = client.chat.completions.create(
            model=model,
            messages=full_messages,
            max_tokens=4096,
        )
    elif mode == "deep":
        resp = local_client.chat.completions.create(
            model=DEEP_MODEL,
            messages=full_messages,
        )
    else:
        resp = local_client.chat.completions.create(
            model=FAST_MODEL,
            messages=full_messages,
        )

    return resp.choices[0].message.content


def chat_with_web_search(messages: list, max_tokens: int = 4096) -> str:
    """Call Kimi with $web_search builtin tool; falls back to plain cloud chat on error."""
    try:
        client = get_cloud_client()
        model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        tools = [{"type": "builtin_function", "function": {"name": "$web_search"}}]
        system = {"role": "system", "content": SYSTEM_PROMPT}
        msgs = [system] + list(messages)

        for _ in range(6):
            resp = client.chat.completions.create(
                model=model, messages=msgs, tools=tools, max_tokens=max_tokens
            )
            choice = resp.choices[0]
            if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
                asst = {
                    "role": "assistant",
                    "content": choice.message.content or "",
                    "tool_calls": [
                        {"id": tc.id, "type": tc.type,
                         "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                        for tc in choice.message.tool_calls
                    ],
                }
                msgs.append(asst)
                for tc in choice.message.tool_calls:
                    # Pass arguments back — contains Moonshot's search_id for server-side results
                    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": tc.function.arguments})
            else:
                return choice.message.content or ""
        return choice.message.content or ""
    except Exception:
        return chat(messages, mode="cloud")


def build_company_context(company: dict, contacts: list, interactions: list, todos: list) -> str:
    lines = [
        f"企业名称：{company['name']}",
        f"行业：{company['industry']}",
        f"客户等级：{company['level']}",
        f"授信额度：{company['credit_limit']}万元",
        f"合作产品：{', '.join(company.get('products', []))}",
        f"备注：{company['notes']}",
    ]

    if contacts:
        lines.append("\n联系人：")
        for c in contacts:
            primary = "（主要联系人）" if c.get("is_primary") else ""
            lines.append(f"  {c['name']} {c.get('position','')} {primary} 电话:{c.get('phone','')} 微信:{c.get('wechat','')}")

    lines.append("\n近期互动记录：")
    for i in interactions[:20]:
        contact_name = i.get("contact_name", "")
        who = f"[{contact_name}] " if contact_name else ""
        lines.append(f"  [{i['date']}] {i['type']} {who}：{i['content']}")
        if i.get("next_action"):
            lines.append(f"    → 下一步：{i['next_action']}")

    pending = [t for t in todos if not t["done"]]
    if pending:
        lines.append("\n待办事项：")
        for t in pending:
            lines.append(f"  [{t['date']}] {t['content']}")

    return "\n".join(lines)
