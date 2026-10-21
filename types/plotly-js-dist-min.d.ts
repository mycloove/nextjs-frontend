declare module 'plotly.js-dist-min' {
  type Data = Record<string, unknown>
  type Layout = Record<string, unknown>
  type Config = Record<string, unknown>

  const Plotly: {
    newPlot: (root: HTMLElement, data: Data[], layout?: Partial<Layout>, config?: Partial<Config>) => Promise<HTMLElement>
    toImage: (root: HTMLElement, options: { format: 'svg'; width: number; height: number }) => Promise<string>
    purge: (root: HTMLElement) => void
  }

  export default Plotly
}
