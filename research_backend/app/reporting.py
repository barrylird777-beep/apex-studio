from datetime import datetime
from io import BytesIO
from reportlab.pdfgen import canvas

def build_pdf(title:str,lines:list[str])->bytes:
 out=BytesIO(); pdf=canvas.Canvas(out)
 pdf.setTitle(title); y=800; pdf.drawString(40,y,title); y-=24
 for line in lines:
  if y<50: pdf.showPage(); y=800
  pdf.drawString(40,y,str(line)[:110]); y-=16
 pdf.save(); return out.getvalue()
