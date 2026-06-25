from reportlab.lib import colors
from reportlab.lib.pagesizes import portrait
from reportlab.lib.units import cm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


OUT = "output/pdf/fixed-international-10x15-gst-export-invoice.pdf"
PAGE_W, PAGE_H = 10 * cm, 15 * cm
M = 0.45 * cm
BLUE = colors.HexColor("#073b78")
LIGHT = colors.HexColor("#e7edf5")
GRID = colors.HexColor("#202020")
MID = colors.HexColor("#8a8a8a")


def fit_font(text, font, max_size, max_width, min_size=4.2):
    size = max_size
    while size > min_size and stringWidth(text, font, size) > max_width:
        size -= 0.1
    return size


def draw_text(c, text, x, y, size=6, font="Helvetica", color=colors.black, align="left", max_width=None):
    if max_width:
        size = fit_font(text, font, size, max_width)
    c.setFont(font, size)
    c.setFillColor(color)
    if align == "right":
        c.drawRightString(x, y, text)
    elif align == "center":
        c.drawCentredString(x, y, text)
    else:
        c.drawString(x, y, text)


def draw_wrapped(c, text, x, y, w, size=5.7, font="Helvetica", leading=6.8, color=colors.black):
    words = text.split()
    lines = []
    line = ""
    for word in words:
        trial = word if not line else f"{line} {word}"
        if stringWidth(trial, font, size) <= w:
            line = trial
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    for i, line in enumerate(lines):
        draw_text(c, line, x, y - i * leading, size, font, color)
    return y - len(lines) * leading


def hline(c, y, x1=None, x2=None, width=0.55, color=GRID):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x1 or M, y, x2 or PAGE_W - M, y)


def vline(c, x, y1, y2, width=0.55, color=GRID):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x, y1, x, y2)


def band(c, y_top, h, title):
    c.setFillColor(LIGHT)
    c.rect(M, y_top - h, PAGE_W - 2 * M, h, fill=1, stroke=0)
    draw_text(c, title, M + 3, y_top - h + 5.5, 6.3, "Helvetica-Bold", colors.black)
    hline(c, y_top, width=0.5, color=MID)
    hline(c, y_top - h, width=0.5, color=MID)


def draw_meta_row(c, y, cells, bold_first=False):
    col_w = (PAGE_W - 2 * M) / 3
    for i, text in enumerate(cells):
        font = "Helvetica-Bold" if bold_first or text.startswith(("Invoice:", "Date:", "AWB:")) else "Helvetica"
        draw_text(c, text, M + 3 + i * col_w, y - 8.3, 5.35, font, max_width=col_w - 5)
    hline(c, y - 12, width=0.35, color=MID)


def make_pdf():
    c = canvas.Canvas(OUT, pagesize=portrait((PAGE_W, PAGE_H)))
    c.setTitle("Tax Invoice - Commercial Export")

    # Outer border
    c.setStrokeColor(GRID)
    c.setLineWidth(0.9)
    c.rect(M, M, PAGE_W - 2 * M, PAGE_H - 2 * M, fill=0, stroke=1)

    y = PAGE_H - M

    # Header
    header_h = 0.96 * cm
    draw_text(c, "TAX INVOICE", PAGE_W / 2, y - 13.2, 10.3, "Helvetica-Bold", BLUE, "center")
    draw_text(c, "COMMERCIAL EXPORT", PAGE_W / 2, y - 25.0, 5.9, "Helvetica-Bold", BLUE, "center")
    hline(c, y - header_h, width=0.75)
    y -= header_h

    # Exporter
    exporter_h = 1.52 * cm
    draw_text(c, "EXPORTER", M + 3, y - 9.2, 5.9, "Helvetica-Bold", BLUE)
    draw_text(c, "BYKR TECH PVT LTD", M + 43, y - 9.2, 8.3, "Helvetica-Bold", colors.black)
    draw_text(
        c,
        "815 23rd Cross Road, 8A Main Road, 7th Sector, HSR Layout, Bengaluru, Karnataka 560102,",
        M + 3,
        y - 20.0,
        5.55,
        max_width=PAGE_W - 2 * M - 6,
    )
    draw_text(c, "India", M + 3, y - 28.0, 5.55)
    draw_text(c, "8904137604  |  support@bykr.co", M + 3, y - 38.2, 5.55)
    hline(c, y - exporter_h, width=0.65, color=MID)
    y -= exporter_h

    # Metadata
    row_h = 0.42 * cm
    rows = [
        ["GSTIN: 29AAOCB1362R1ZX", "IEC/PAN: AAOCB1362R", "Bank AD Code: 00000006360108"],
        ["Invoice: 10397", "Date: 2026-06-24", "AWB: -"],
        ["LUT: AD2906260133427", "IOSS: N/A", "Reverse charge: No"],
        ["Export using e-commerce: Yes", "Incoterm: CIF", "Origin: India"],
        ["Destination: Norway", "Currency: INR", "Pieces: 1"],
    ]
    for idx, row in enumerate(rows):
        draw_meta_row(c, y, row, bold_first=(idx == 1))
        y -= row_h
    draw_text(c, "Place of supply: Bangalore (KA)", M + 3, y - 8.3, 5.35)
    hline(c, y - 12, width=0.35, color=MID)
    y -= row_h

    # Consignee
    band(c, y, 0.48 * cm, "CONSIGNEE / SHIP TO")
    y -= 0.48 * cm
    consignee_h = 1.62 * cm
    draw_text(c, "Vegard Forsberg", M + 3, y - 9.0, 5.9, "Helvetica-Bold")
    draw_text(c, "Tellusvegen 15g", M + 3, y - 17.2, 5.55)
    draw_text(c, "Hvam, NO-02, 2165", M + 3, y - 25.2, 5.55)
    draw_text(c, "Norway", M + 3, y - 33.2, 5.55)
    draw_text(c, "Tel: 48122151 | Email: vegard_forsberg_89@hotmail.com", M + 3, y - 42.0, 5.25)
    hline(c, y - consignee_h, width=0.65)
    y -= consignee_h

    # Item table
    table_w = PAGE_W - 2 * M
    hdr_h = 0.56 * cm
    item_h = 0.42 * cm
    total_h = 0.38 * cm
    col = [
        M,
        M + 0.44 * cm,
        M + 3.78 * cm,
        M + 4.72 * cm,
        M + 5.55 * cm,
        M + 7.22 * cm,
        M + 8.10 * cm,
        M + table_w,
    ]
    c.setFillColor(LIGHT)
    c.rect(M, y - hdr_h, table_w, hdr_h, fill=1, stroke=0)
    headers = [
        ("#", (col[0] + col[1]) / 2, "center"),
        ("Description", col[1] + 2, "left"),
        ("HSN", (col[2] + col[3]) / 2, "center"),
        ("Qty", (col[3] + col[4]) / 2, "center"),
        ("Unit price", col[5] - 3, "right"),
        ("IGST", (col[5] + col[6]) / 2, "center"),
        ("Amount", col[7] - 3, "right"),
    ]
    table_top = y
    for text, x, align in headers:
        draw_text(c, text, x, y - 10.1, 4.95, "Helvetica-Bold", BLUE, align)
    hline(c, y, width=0.65)
    hline(c, y - hdr_h, width=0.35, color=MID)
    y -= hdr_h

    draw_text(c, "1", (col[0] + col[1]) / 2, y - 7.7, 5.0, align="center")
    desc_y = draw_wrapped(c, "RE Himalayan 450 - Hold My Throttle", col[1] + 2, y - 7.7, col[2] - col[1] - 5, 5.0, leading=5.8)
    draw_text(c, "90328910", col[3] - 3, y - 7.7, 5.0, align="right")
    draw_text(c, "1", (col[3] + col[4]) / 2, y - 7.7, 5.0, align="center")
    draw_text(c, "15999.00", col[5] - 3, y - 7.7, 5.0, align="right")
    draw_text(c, "0%", (col[5] + col[6]) / 2, y - 7.7, 5.0, align="center")
    draw_text(c, "15999.00", col[7] - 3, y - 7.7, 5.0, align="right")
    hline(c, y - item_h, width=0.5, color=MID)
    for x in col:
        vline(c, x, table_top, y - item_h, width=0.25, color=MID)
    y -= item_h
    draw_text(c, "Total before tax: INR 15999.00", M + 3, y - 7.8, 5.35, "Helvetica-Bold")
    hline(c, y - total_h, width=0.65)
    y -= total_h

    # Declaration and totals
    split = M + table_w * 0.545
    block_h = 2.55 * cm
    vline(c, split, y, y - block_h, width=0.5, color=MID)
    draw_text(c, "EXPORT DECLARATION", M + 3, y - 8.0, 5.8, "Helvetica-Bold", BLUE)
    draw_wrapped(
        c,
        "Supply meant for export under Letter of Undertaking without payment of IGST.",
        M + 3,
        y - 18.2,
        split - M - 8,
        4.9,
        "Helvetica-Bold",
        leading=5.8,
    )
    draw_wrapped(
        c,
        "We declare that this invoice shows the actual price of the goods described and all particulars are true and correct.",
        M + 3,
        y - 37.6,
        split - M - 8,
        4.8,
        "Helvetica",
        leading=5.7,
    )
    tx_l = split + 7
    tx_r = PAGE_W - M - 8
    totals = [
        ("Product Amount", "INR 15999.00", "Helvetica", colors.black),
        ("Shipping", "INR 2999.00", "Helvetica", colors.black),
        ("Insurance", "INR 0.00", "Helvetica", colors.black),
        ("Total IGST", "INR 0.00", "Helvetica", colors.black),
        ("TOTAL AFTER TAX", "INR 18998.00", "Helvetica-Bold", BLUE),
    ]
    ty = y - 31
    for label, amount, font, color in totals:
        if label == "TOTAL AFTER TAX":
            c.setFillColor(colors.HexColor("#f1f5fb"))
            c.rect(split + 1, ty - 3.4, PAGE_W - M - split - 2, 8.5, fill=1, stroke=0)
        draw_text(c, label, tx_l, ty, 5.1, font, color)
        draw_text(c, amount, tx_r, ty, 5.1, font, color, "right")
        ty -= 8.0
    hline(c, y - block_h, width=0.65)
    y -= block_h

    # Footer
    draw_text(c, "ORIGINAL FOR RECIPIENT / CUSTOMS", PAGE_W - M - 3, y - 8.4, 5.8, "Helvetica-Bold", align="right")
    draw_text(
        c,
        "Electronically generated invoice under the IT Act, 2000. Signature not required.",
        M + 3,
        y - 24.5,
        4.9,
        max_width=PAGE_W - 2 * M - 6,
    )

    c.showPage()
    c.save()


if __name__ == "__main__":
    make_pdf()
