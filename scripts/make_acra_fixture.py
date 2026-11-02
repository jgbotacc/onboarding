"""Generate a fake ACRA-style Business Profile fixture (all details invented).

Writes tests/fixtures/acra_fake.pdf (reportlab) and tests/fixtures/acra_fake.txt
(hand-written pdftotext -layout style text of the same content) plus README.md.
Never copies any real sample: names, UEN, addresses and ID numbers are made up.
Usage: python scripts/make_acra_fixture.py [out_dir]
"""
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("tests/fixtures")

PDF_LINES = [
    "ACCOUNTING AND CORPORATE REGULATORY AUTHORITY",
    "Business Profile (Company) of LUMEN KOPI PTE. LTD. (202498765K)",
    "",
    "Entity Information",
    "UEN : 202498765K",
    "Name : LUMEN KOPI PTE. LTD.",
    "Former Name if any :",
    "Type : EXEMPT PRIVATE COMPANY LIMITED BY SHARES",
    "Status : LIVE COMPANY",
    "",
    "Business Activity",
    "Activity : CAFES AND COFFEE HOUSES (56122)",
    "Description :",
    "",
    "Registered Office Address : 8 EXAMPLE ROAD, #02-15, SINGAPORE (098765)",
    "",
    "Officers",
    "Name  Identification No.  Position Held  Nationality/Citizenship  Date of Appointment",
    "TAN MEI LING  S1234567D  Director  SINGAPORE CITIZEN  01/02/2024",
    "ONG WEI JIE  S7654321A  Secretary  SINGAPORE CITIZEN  01/02/2024",
]

# Column-aligned text as `pdftotext -layout` would render the same profile.
LAYOUT_TEXT = """\
ACCOUNTING AND CORPORATE REGULATORY AUTHORITY
Business Profile (Company) of LUMEN KOPI PTE. LTD. (202498765K)

Entity Information
UEN                        : 202498765K
Name                       : LUMEN KOPI PTE. LTD.
Former Name if any         :
Type                       : EXEMPT PRIVATE COMPANY LIMITED BY SHARES
Status                     : LIVE COMPANY

Business Activity
Activity                   : CAFES AND COFFEE HOUSES (56122)
Description                :

Registered Office Address  : 8 EXAMPLE ROAD, #02-15, SINGAPORE (098765)

Officers
Name            Identification No.   Position Held   Nationality/Citizenship   Date of Appointment
TAN MEI LING    S1234567D            Director        SINGAPORE CITIZEN         01/02/2024
ONG WEI JIE     S7654321A            Secretary       SINGAPORE CITIZEN         01/02/2024
"""

README = """\
# Fixtures

`acra_fake.pdf` and `acra_fake.txt` are a made-up ACRA-style Business Profile
for testing only. Every detail is invented (business name, UEN, addresses,
officer names, ID numbers); any resemblance to a real business is coincidence.
The fake NRICs (`S1234567D`, `S7654321A`) exist to prove ID numbers are dropped
at extraction. Regenerate with `python scripts/make_acra_fixture.py`.
"""


def main() -> None:
    from reportlab.pdfgen import canvas

    OUT.mkdir(parents=True, exist_ok=True)
    pdf = OUT / "acra_fake.pdf"
    c = canvas.Canvas(str(pdf))
    for i, t in enumerate(PDF_LINES):
        c.drawString(72, 760 - i * 24, t)
    c.save()
    (OUT / "acra_fake.txt").write_text(LAYOUT_TEXT)
    (OUT / "README.md").write_text(README)
    print(pdf)


if __name__ == "__main__":
    main()
