Self-hosted fonts for the staff console (#/staff).
Used only from web/src/staff/staff.css via @font-face; the client chat site
keeps its own stack and is untouched.

Files in this directory:
- ibm-plex-sans-var.ttf — IBM Plex Sans variable (width + weight axes),
  used for text at weights 400 / 500 / 600.
- ibm-plex-mono-regular.ttf — IBM Plex Mono 400, for IDs and tabular figures.
- ibm-plex-mono-medium.ttf — IBM Plex Mono 500, for emphasised figures.
- ibm-plex-mono-semibold.ttf — IBM Plex Mono 600, fallback for semibold figures.
- OFL.txt — the licence both families ship under (this file).

Source: IBM Plex, Copyright (c) IBM Corporation, licensed under the SIL Open
Font License 1.1. Copies taken from the system font store on the build machine
(/usr/share/fonts/truetype/sand-box/google/), unmodified apart from file names.
No CDN links; if a file fails to load, staff.css falls back to
Inter, system-ui, sans-serif (sans) or ui-monospace, monospace (mono).
