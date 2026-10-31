const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const PaperclipIcon = () => (
  <svg {...base}><path d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l5.5-5.5a2.3 2.3 0 0 1 3.3 3.3L6.3 11.3a1.2 1.2 0 0 1-1.7-1.7L9.5 4.7" /></svg>
);
export const SendIcon = () => (
  <svg {...base}><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" /></svg>
);
export const FileIcon = () => (
  <svg {...base} width={14} height={14}><path d="M9 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V5.5L9 1.75Z" /><path d="M9 1.75V5.5h3.75" /></svg>
);
export const ImageIcon = () => (
  <svg {...base} width={14} height={14}><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><circle cx="6" cy="6.5" r="1.25" /><path d="m14 11-3.5-3.5L4 13.5" /></svg>
);
export const CloseIcon = () => (
  <svg {...base} width={12} height={12}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const CheckboxIcon = () => (
  <svg {...base} width={14} height={14}><rect x="2.5" y="2.5" width="11" height="11" rx="2" /></svg>
);
