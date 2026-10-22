"""Render the project's limited Markdown syntax into a dependency-free reading view."""
from pathlib import Path
import html
import re

root = Path(__file__).resolve().parent.parent
lines = (root / 'DESIGN_SPEC.md').read_text().splitlines()

def inline(text):
    text = html.escape(text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)

out, toc = [], []
i = 0
while i < len(lines):
    line = lines[i]
    if not line:
        i += 1
        continue
    if line.startswith('```'):
        block = []
        i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            block.append(lines[i])
            i += 1
        out.append('<pre><code>' + html.escape('\n'.join(block)) + '</code></pre>')
        i += 1
        continue
    heading = re.match(r'^(#{1,3}) (.*)', line)
    if heading:
        level, text = len(heading[1]), heading[2]
        anchor = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
        out.append(f'<h{level} id="{anchor}">{inline(text)}</h{level}>')
        if level == 2:
            toc.append(f'<a href="#{anchor}">{html.escape(text)}</a>')
        i += 1
        continue
    if line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            cells = [c.strip() for c in lines[i].strip('|').split('|')]
            if not all(re.fullmatch(r'[:\- ]+', c) for c in cells):
                tag = 'th' if not rows else 'td'
                rows.append('<tr>' + ''.join(f'<{tag}>' + inline(c) + f'</{tag}>' for c in cells) + '</tr>')
            i += 1
        out.append('<div class="table-scroll"><table><thead>' + rows[0] + '</thead><tbody>' + ''.join(rows[1:]) + '</tbody></table></div>')
        continue
    if line.startswith('- ') or re.match(r'^\d+\. ', line):
        ordered = bool(re.match(r'^\d+\. ', line))
        tag = 'ol' if ordered else 'ul'
        entries = []
        while i < len(lines) and (re.match(r'^\d+\. ', lines[i]) if ordered else lines[i].startswith('- ')):
            entries.append('<li>' + inline(re.sub(r'^(?:- |\d+\. )', '', lines[i])) + '</li>')
            i += 1
        out.append(f'<{tag}>' + ''.join(entries) + f'</{tag}>')
        continue
    para = [line]
    i += 1
    while i < len(lines) and lines[i] and not re.match(r'^(#|\||```|- |\d+\. )', lines[i]):
        para.append(lines[i])
        i += 1
    out.append('<p>' + inline(' '.join(para)) + '</p>')

page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoSec Workspace design specification</title><style>
:root{font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202b36;background:#f5f7f8}*{box-sizing:border-box}body{margin:0}header{background:#152b38;color:white;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:20px 36px}header strong{font-size:16px;font-weight:550}header a{color:#e9f2f4;font-size:12px;text-decoration:none;margin-left:20px}.layout{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1500px;margin:auto}aside{padding:34px 24px;position:sticky;top:0;height:100vh;overflow:auto}aside small{font-size:10px;letter-spacing:1.1px;text-transform:uppercase;color:#62707c;display:block;margin-bottom:14px}aside a{display:block;font-size:12px;text-decoration:none;color:#62707c;padding:5px 8px;line-height:1.55;border-left:1px solid #dfe4e7}aside a:hover{color:#204d57;border-color:#204d57;background:#eaf1f2}article{background:white;padding:48px 54px 90px;min-width:0}h1{font-size:30px;line-height:1.3;letter-spacing:-.5px;font-weight:600;margin:0 0 24px;max-width:720px}h2{font-size:23px;font-weight:600;letter-spacing:-.5px;margin:50px 0 18px;scroll-margin-top:30px}h3{font-size:16px;margin:30px 0 12px}p{margin:14px 0}p,li{max-width:850px}li{margin:9px 0}a{color:#204d57}code{background:#f1f4f5;font-size:12px;padding:3px 5px;border-radius:3px}pre{background:#f1f4f5;padding:24px;overflow:auto;border-radius:6px;font-size:12px;line-height:1.7}pre code{padding:0}.table-scroll{overflow:auto;margin:24px 0}table{border-collapse:collapse;width:100%;font-size:12px;line-height:1.65}th,td{text-align:left;vertical-align:top;border:1px solid #dfe4e7;padding:12px 14px;min-width:135px}th{background:#edf2f3;color:#273d45;font-weight:600}tbody tr:nth-child(even){background:#fafbfc}:focus-visible{outline:3px solid #337b9c;outline-offset:3px}.skip{position:absolute;left:-999px}.skip:focus{left:20px;background:white;padding:12px;z-index:10}@media(max-width:1000px){.layout{grid-template-columns:210px minmax(0,1fr)}article{padding:36px 28px}aside{padding:30px 16px}h1{font-size:30px}}@media(max-width:700px){.layout{display:block}aside{position:static;height:auto;max-height:210px;border-bottom:1px solid #dfe4e7}header{padding:18px 20px;align-items:start;flex-direction:column;gap:8px}header a{margin:0 20px 0 0}article{padding:28px 20px 60px}h1{font-size:29px}h2{font-size:21px}table{min-width:650px}}@media print{header,aside{display:none}.layout{display:block}article{padding:0}h2{break-after:avoid}tr{break-inside:avoid}pre{white-space:pre-wrap}}
</style></head><body><a class="skip" href="#main">Skip to specification</a><header><strong>CoSec design specification</strong><nav><a href="prototype/index.html?variant=A">Open prototype →</a><a href="DESIGN_SPEC.md" download>Download Markdown ↓</a></nav></header><div class="layout"><aside aria-label="Contents"><small>Contents</small>TOC</aside><article id="main">BODY</article></div></body></html>'''
(root / 'design-spec.html').write_text(page.replace('TOC', ''.join(toc)).replace('BODY', '\n'.join(out)))
print('Rendered design-spec.html')
