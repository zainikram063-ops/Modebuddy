const P: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  pin: "M9 4h6l-1 6 4 3v2H6v-2l4-3-1-6zM12 15v5",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16v4z",
  clip: "M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7",
  send: "M5 12h14M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12l5 5L20 7",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  brain: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h1V4H9zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h-1V4h1z",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4",
  book: "M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2V5zM20 19v2H6",
  x: "M6 6l12 12M18 6L6 18",
  chevron: "M6 9l6 6 6-6",
  menu: "M4 7h16M4 12h16M4 17h16",
  spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  key: "M7 14a4 4 0 1 1 3.5-6H21v3h-2v3h-3v-3h-5.5A4 4 0 0 1 7 14z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? ""} />
    </svg>
  );
}
