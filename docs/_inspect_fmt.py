# -*- coding: utf-8 -*-
"""检查关键段落的 run 级格式"""
import sys
from docx import Document

sys.stdout.reconfigure(encoding='utf-8')

f = r"d:\family-ledger_RevB\Lunch_HP\docs\我要干饭-开发者说明书-v1.4.docx"
doc = Document(f)

def show(idx, label=""):
    p = doc.paragraphs[idx]
    print(f"\n--- [{idx}] {label} style={p.style.name} ---")
    print(f"text: {p.text[:80]}")
    print(f"pPr XML: {p.paragraph_format.element.xml[:500] if p.paragraph_format.element is not None else 'None'}")
    for j, r in enumerate(p.runs):
        b = r.bold
        sz = r.font.size
        col = r.font.color.rgb if r.font.color and r.font.color.type else None
        print(f"  run[{j}] bold={b} size={sz} color={col} text={r.text[:60]!r}")

# 章节标题
show(50, "第6章标题")
show(70, "第9章标题")
show(78, "第10章标题")
show(91, "第11章标题")
# 列表项
show(54, "第6章列表项")
show(77, "第9章最后列表项")
show(96, "第11章月度统计列表项")
# 封面
show(0, "封面标题")
show(1, "封面副标题")
show(2, "封面版本行")
