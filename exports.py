from io import BytesIO
from datetime import datetime
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


def render(strokes, width=1600, height=1000):
    image = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(image)
    for stroke in strokes:
        points = [(p[0]*width, p[1]*height) for p in stroke['points']]
        radius = max(1, stroke['width']*width/1600)/2
        if len(points)>1:
            draw.line(points, fill=stroke['color'], width=max(1, round(radius*2)), joint='curve')
        for x,y in points:
            draw.ellipse((x-radius,y-radius,x+radius,y+radius), fill=stroke['color'])
    return image


def export(strokes, kind):
    image = render(strokes)
    output = BytesIO()
    if kind == 'pdf':
        pdf = canvas.Canvas(output, pagesize=(842,595))
        pdf.setTitle('Air Canvas AI - Whiteboard')
        pdf.setFont('Helvetica-Bold', 18)
        pdf.drawString(30,560,'AIR CANVAS AI')
        pdf.setFont('Helvetica',9)
        pdf.drawRightString(812,560,datetime.now().strftime('%Y-%m-%d %H:%M'))
        pdf.drawImage(ImageReader(image),30,48,width=782,height=489, preserveAspectRatio=True)
        pdf.drawString(30,25,'Generated using Air Canvas AI')
        pdf.save()
    else:
        image.save(output, format='JPEG' if kind=='jpg' else 'PNG')
    return output.getvalue()
