"""Generate a sample business PDF (missing Email and Design Preferences unless --full) for testing."""
import sys

from reportlab.pdfgen import canvas

out = sys.argv[1] if len(sys.argv) > 1 else "sample-business.pdf"
c = canvas.Canvas(out)
lines = ["B2B Registration Form", "Business Name: Kopi Corner Pte Ltd", "Business Type: Cafe",
         "Industry: F&B", "Contact Name: Ah Hock Tan", "Title/Position: Owner", "Phone Number: +65 6123 4567",
         "Requirements / Notes: Launch post for new branch"]
if "--full" in sys.argv:
    lines += ["Email: hello@kopicorner.example", "Design Preferences: warm retro kopitiam, brown and cream"]
for i, t in enumerate(lines):
    c.drawString(72, 760 - i * 24, t)
c.save()
print(out)
