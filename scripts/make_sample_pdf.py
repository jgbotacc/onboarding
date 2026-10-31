"""Generate a sample business PDF (missing contact on purpose) for testing."""
import sys

from reportlab.pdfgen import canvas

out = sys.argv[1] if len(sys.argv) > 1 else "sample-business.pdf"
c = canvas.Canvas(out)
lines = ["Business Profile", "Company Name: Kopi Corner Pte Ltd", "Address: 12 Example Road, Singapore 000000",
         "Industry: F&B (cafe)", "Tagline: Your daily kopi, done right", "Brand colours: brown and cream"]
for i, t in enumerate(lines):
    c.drawString(72, 760 - i * 24, t)
c.save()
print(out)
