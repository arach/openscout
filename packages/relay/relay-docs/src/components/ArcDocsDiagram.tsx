import { ArcDiagram } from '@arach/arc-viewer'
import type { ArcDiagramData } from '@arach/arc-viewer'

type ArcDocsDiagramProps = {
  data: ArcDiagramData
}

export default function ArcDocsDiagram({ data }: ArcDocsDiagramProps) {
  return (
    <div className="relay-arc-diagram-shell">
      <div className="relay-arc-diagram__canvas">
        <div className="relay-arc-diagram__stage">
          <ArcDiagram
            data={data}
            mode="light"
            theme="mono"
            interactive={true}
            showArcToggle={false}
            label="OSC-SYSMAP-001"
            radiusClassName="rounded-[8px]"
            className="relay-arc-diagram"
          />
        </div>
      </div>

      <p className="relay-arc-diagram__hint">
        One runtime, one durable state model, many surfaces and agents.
      </p>
    </div>
  )
}
