"""Render the shared sheet memo, exported from js/equipment/memo.js, to one A4 page.

Usage: python tools/build-armour-memo.py memo.json output.pdf --font-dir <fonts>
Requires reportlab. The JSON contains sections and source; no campaign data.
"""
import argparse
import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether


def build(source, output, font_dir):
    data = json.loads(Path(source).read_text(encoding="utf-8-sig"))
    fonts = Path(font_dir)
    pdfmetrics.registerFont(TTFont("MemoBody", str(fonts / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("MemoBold", str(fonts / "segoeuib.ttf")))
    pdfmetrics.registerFont(TTFont("MemoTitle", str(fonts / "georgiab.ttf")))
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    ink = colors.HexColor("#282521")
    muted = colors.HexColor("#655c50")
    gold = colors.HexColor("#886524")
    title = ParagraphStyle("title", fontName="MemoTitle", fontSize=22, leading=27, textColor=ink, spaceAfter=6)
    subtitle = ParagraphStyle("subtitle", fontName="MemoBody", fontSize=10, leading=14, textColor=muted, spaceAfter=14)
    heading = ParagraphStyle("heading", fontName="MemoBold", fontSize=11, leading=15, textColor=gold, spaceAfter=3)
    body = ParagraphStyle("body", fontName="MemoBody", fontSize=10, leading=14, textColor=ink, spaceAfter=9)
    source_style = ParagraphStyle("source", fontName="MemoBody", fontSize=8, leading=11, textColor=muted, spaceBefore=6)

    def frame(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(gold)
        canvas.setLineWidth(.8)
        canvas.line(19 * mm, 280 * mm, 191 * mm, 280 * mm)
        canvas.setFont("MemoBody", 8)
        canvas.setFillColor(muted)
        canvas.drawString(19 * mm, 13 * mm, "L'Ennemi Intérieur | Aide à la fiche de personnage")
        canvas.drawRightString(191 * mm, 13 * mm, str(document.page))
        canvas.restoreState()

    story = [Spacer(1, 5 * mm), Paragraph("Armes &amp; armures", title),
             Paragraph("Comprendre les PA affichés sur la fiche", subtitle)]
    for name, text in data["sections"]:
        story.append(KeepTogether([Paragraph(escape(name), heading), Paragraph(escape(text), body)]))
    story.append(Paragraph(escape(data["source"]), source_style))
    document = SimpleDocTemplate(str(target), pagesize=A4, leftMargin=19 * mm, rightMargin=19 * mm,
                                 topMargin=19 * mm, bottomMargin=21 * mm,
                                 title="Armes et armures - mémo de la fiche", author="L'Ennemi Intérieur")
    document.build(story, onFirstPage=frame, onLaterPages=frame)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--font-dir", required=True)
    args = parser.parse_args()
    build(args.source, args.output, args.font_dir)
