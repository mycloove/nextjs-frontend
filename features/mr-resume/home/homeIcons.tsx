// Home icons: 24px grid, 1.75px stroke, currentColor. Each depicts what the
// control does to a document (a page, a source brace, a filter funnel), not a
// generic decoration.
export type HomeIconName = 'page' | 'source' | 'arrow' | 'search' | 'filter' | 'close' | 'prev' | 'next' | 'check' | 'menu' | 'device' | 'import' | 'copy' | 'grid' | 'minus' | 'plus'

const paths: Record<HomeIconName, string> = {
  page: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 15.5h5M10 8.5h2',
  source: 'M9 5C6.5 5 7 9 5 12c2 3 1.5 7 4 7M15 5c2.5 0 2 4 4 7-2 3-1.5 7-4 7',
  arrow: 'M5 12h13M13 7l5 5-5 5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  filter: 'M4 6h16M7 12h10M10 18h4',
  close: 'M6 6l12 12M18 6 6 18',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  device: 'M5 5h14v10H5zM9 19h6M12 15v4',
  import: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
}

export function HomeIcon({ name, className }: { name: HomeIconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
