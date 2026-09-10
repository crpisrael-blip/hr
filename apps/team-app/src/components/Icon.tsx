const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  jobs: 'M8 7V4h8v3M3 8h18v13H3zM3 13c6 3 12 3 18 0M12 12v4',
  candidates: 'M16 21v-2a5 5 0 0 0-10 0v2M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 5a3 3 0 0 1 0 6M20 21v-3a4 4 0 0 0-3-4',
  companies: 'M3 21V3h10v18M13 9h8v12M7 7h2M7 11h2M7 15h2M17 13h1M17 17h1M2 21h20',
  applications: 'M20 11a8 8 0 1 0-4 7M17 17l5 5M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0',
  placements: 'M20 12a8 8 0 1 1-8-8M16 12a4 4 0 1 1-4-4M12 12l9-9M17 3h4v4',
  reports: 'M4 3v18h18M8 16v-5M13 16V7M18 16V4',
  tasks: 'M20 12a8 8 0 1 1-5-7M8 11l4 4 9-11',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M8 14h1M15 14h1M8 17h1',
  settings: 'm9 3-1 3-3 1-2 4 2 2v3l3 3 3-1 3 2 4-2v-3l3-2-1-4-3-1-1-3zM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4M12 2v2',
  search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14M15 15l6 6',
  arrow: 'M20 12H4M10 6l-6 6 6 6',
};
export default function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.jobs} /></svg>;
}
