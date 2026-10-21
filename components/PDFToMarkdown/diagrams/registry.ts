import type { DiagramCapability, DiagramEngine, DiagramTemplate } from './types'

export const DIAGRAM_CAPABILITIES: DiagramCapability[] = [
  { engine: 'mermaid', label: 'Mermaid', runtime: 'browser', available: true, description: 'Flowcharts, sequence diagrams, and more.' },
  { engine: 'wavedrom', label: 'WaveDrom', runtime: 'browser', available: true, description: 'Digital timing diagrams.' },
  { engine: 'bitfield', label: 'Bitfield', runtime: 'browser', available: true, description: 'Binary field layouts.' },
  { engine: 'graphviz', label: 'GraphViz', runtime: 'browser', available: true, description: 'DOT graphs with selectable layouts.' },
  { engine: 'vega', label: 'Vega', runtime: 'browser', available: true, description: 'Declarative visualization specifications.' },
  { engine: 'vega-lite', label: 'Vega-Lite', runtime: 'browser', available: true, description: 'Concise statistical visualization specifications.' },
  { engine: 'plotly', label: 'Plotly', runtime: 'browser', available: true, description: 'Declarative charts from JSON or YAML.' },
  { engine: 'plantuml', label: 'PlantUML', runtime: 'server', available: false, description: 'UML diagrams through the render service.' },
  { engine: 'd2', label: 'D2', runtime: 'server', available: false, description: 'Declarative diagrams through the render service.' },
  { engine: 'tikz', label: 'TikZ', runtime: 'server', available: false, description: 'TeX diagrams through the render service.' },
  { engine: 'ditaa', label: 'Ditaa', runtime: 'server', available: false, description: 'ASCII art diagrams through the render service.' },
  { engine: 'kroki', label: 'Kroki', runtime: 'server', available: false, description: 'Remote diagram rendering through a server proxy.' },
  { engine: 'wsd', label: 'WebSequenceDiagrams', runtime: 'server', available: false, description: 'Sequence diagrams through a server proxy.' },
]

export function getDiagramCapability(engine: DiagramEngine): DiagramCapability {
  return DIAGRAM_CAPABILITIES.find((item) => item.engine === engine) ?? {
    engine,
    label: engine,
    runtime: 'server',
    available: false,
    description: 'This diagram engine is unavailable.',
  }
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    engine: 'mermaid', label: 'Mermaid flowchart', language: 'mermaid',
    description: 'Flowcharts, sequence diagrams, timelines, and more.',
    runtime: 'browser', exportQuality: 'native',
    source: 'flowchart TD\n  Start([Start]) --> Decision{Choose a path}\n  Decision -->|Yes| Done([Done])\n  Decision -->|No| Retry([Try again])',
  },
  {
    engine: 'plantuml', label: 'PlantUML sequence', language: 'plantuml',
    description: 'UML diagrams rendered when the server renderer is available.',
    runtime: 'server', exportQuality: 'native',
    source: '@startuml\nAlice -> Bob: Authentication request\nBob --> Alice: Authentication response\n@enduml',
  },
  {
    engine: 'wavedrom', label: 'WaveDrom timing', language: 'wavedrom',
    description: 'Digital timing and signal diagrams.',
    runtime: 'browser', exportQuality: 'native',
    source: '{\n  signal: [\n    { name: "clk", wave: "p.....|..." },\n    { name: "data", wave: "x.345x|=.x", data: ["head", "body", "tail", "data"] },\n    { name: "req", wave: "0.1..0|1.0" }\n  ]\n}',
  },
  {
    engine: 'graphviz', label: 'GraphViz graph', language: 'dot',
    description: 'DOT graphs with selectable layout engines.',
    runtime: 'browser', exportQuality: 'native',
    source: 'digraph G {\n  rankdir=LR;\n  Start -> Parse -> Render -> Export;\n}',
  },
  {
    engine: 'd2', label: 'D2 diagram', language: 'd2',
    description: 'Declarative diagrams with optional layout and theme attributes.',
    runtime: 'server', exportQuality: 'native',
    source: 'User: {\n  shape: person\n}\nEditor -> Preview: renders\nPreview -> Export: produces a file',
    attributes: 'layout="dagre" theme="0"',
  },
  {
    engine: 'tikz', label: 'TikZ diagram', language: 'tikz',
    description: 'TeX diagrams, circuits, plots, and mathematical figures.',
    runtime: 'server', exportQuality: 'native',
    source: '\\begin{tikzpicture}\n  \\draw[->] (0,0) -- (3,0) node[right] {flow};\n  \\draw (0,0) circle (0.35);\n\\end{tikzpicture}',
  },
  {
    engine: 'wsd', label: 'Web sequence', language: 'wsd',
    description: 'Sequence diagrams through the configured web service.',
    runtime: 'remote', exportQuality: 'raster',
    source: 'Alice->Bob: Hello Bob, how are you?\nNote right of Bob: Bob thinks\nBob-->Alice: I am good thanks!',
  },
  {
    engine: 'vega', label: 'Vega chart', language: 'vega',
    description: 'Full Vega JSON visualization specification.',
    runtime: 'browser', exportQuality: 'native',
    source: '{\n  "$schema": "https://vega.github.io/schema/vega/v6.json",\n  "width": 420, "height": 220,\n  "data": [{"name": "table", "values": [{"category": "A", "value": 28}, {"category": "B", "value": 55}, {"category": "C", "value": 43}]}],\n  "marks": [{"type": "rect", "from": {"data": "table"}, "encode": {"enter": {"x": {"scale": "x", "field": "category"}, "width": {"scale": "x", "band": 1}, "y": {"scale": "y", "field": "value"}, "y2": {"scale": "y", "value": 0}}}}],\n  "scales": [{"name": "x", "type": "band", "domain": {"data": "table", "field": "category"}, "range": "width"}, {"name": "y", "domain": {"data": "table", "field": "value"}, "range": "height"}]\n}',
  },
  {
    engine: 'vega-lite', label: 'Vega-Lite chart', language: 'vega-lite',
    description: 'Compact JSON or YAML statistical visualization specification.',
    runtime: 'browser', exportQuality: 'native',
    source: '{\n  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",\n  "data": {"values": [{"category": "A", "value": 28}, {"category": "B", "value": 55}, {"category": "C", "value": 43}]},\n  "mark": "bar",\n  "encoding": {"x": {"field": "category", "type": "nominal"}, "y": {"field": "value", "type": "quantitative"}}\n}',
  },
  {
    engine: 'kroki', label: 'Kroki diagram', language: 'blockdiag',
    description: 'Route a supported diagram language through Kroki.',
    runtime: 'remote', exportQuality: 'native',
    attributes: 'kroki=true',
    source: 'blockdiag {\n  Kroki -> renders -> diagrams;\n  diagrams -> become -> images;\n}',
  },
  {
    engine: 'ditaa', label: 'Ditaa diagram', language: 'ditaa',
    description: 'ASCII art diagrams rendered by the configured server.',
    runtime: 'server', exportQuality: 'native',
    source: '+--------+     +--------+\n| Input  | --> | Output |\n+--------+     +--------+',
  },
  {
    engine: 'plotly', label: 'Plotly chart', language: 'plotly',
    description: 'Plotly JSON charts for interactive data visualization.',
    runtime: 'browser', exportQuality: 'raster',
    source: '{\n  "data": [{"x": ["A", "B", "C"], "y": [28, 55, 43], "type": "bar"}],\n  "layout": {"title": "Example chart"}\n}',
  },
]
