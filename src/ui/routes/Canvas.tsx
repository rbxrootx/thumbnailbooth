import { useCallback, useMemo } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, Position, ReactFlow,
  addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "../lib/store.js";
import { RegistrationTarget } from "../components/PressMarks.js";
import { Image as ImageIcon, Sheet as SheetIcon, Stop } from "../components/Icons.js";

/**
 * The flat plan: the same job laid out as linked plates instead of a docket.
 *
 * A press check has an imposition sheet showing how the parts of a job relate
 * before it runs; that is what this is. The Composer compiles into it, so the
 * canvas is a second view of one job rather than a second product.
 */

const PLATE =
  "sheet-shadow-sm min-w-[210px] bg-stock text-ink border border-stock-rule";
const PLATE_HEAD =
  "legend flex items-center gap-1.5 border-b border-stock-rule px-3 py-2 text-ink-50";

function Plate({
  title, children, icon,
}: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className={PLATE}>
      <div className={PLATE_HEAD}>{icon}{title}</div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

const dot = "!h-2 !w-2 !border !border-ink !bg-stock";

function ConceptNode() {
  const concept = useStore((s) => s.concept);
  const title = useStore((s) => s.title);
  return (
    <>
      <Plate title="Concept" icon={<SheetIcon />}>
        <p className="max-w-[220px] text-[12.5px] leading-snug">
          {concept || <span className="text-ink-50">Nothing described yet</span>}
        </p>
        {title ? (
          <p className="mt-2 border-t border-stock-rule pt-2 text-[11px] text-ink-70">
            Title: “{title}”
          </p>
        ) : null}
      </Plate>
      <Handle type="source" position={Position.Right} className={dot} />
    </>
  );
}

function RefsNode() {
  const refs = useStore((s) => s.refs);
  return (
    <>
      <Plate title="References" icon={<ImageIcon />}>
        {refs.length ? (
          <div className="flex flex-wrap gap-1">
            {refs.slice(0, 6).map((ref, i) => (
              <img key={i} src={`data:${ref.mimeType};base64,${ref.data}`} alt=""
                className="h-9 w-9 object-cover" />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-ink-50">None attached</p>
        )}
      </Plate>
      <Handle type="source" position={Position.Right} className={dot} />
    </>
  );
}

function StyleNode() {
  const useCustom = useStore((s) => s.useCustomRules);
  return (
    <>
      <Plate title="Style rules">
        <p className="text-[12px] text-ink-70">
          {useCustom ? "Custom rules" : "House style"}
        </p>
      </Plate>
      <Handle type="source" position={Position.Right} className={dot} />
    </>
  );
}

function PressNode() {
  const s = useStore();
  const spec = useStore((st) => st.modelSpec());
  const done = s.frames.filter((f) => f.status === "done").length;

  return (
    <>
      <Handle type="target" position={Position.Left} className={dot} />
      <div className={PLATE}>
        <div className={PLATE_HEAD}>Press</div>
        <div className="space-y-1.5 px-3 py-2.5">
          <Spec label="Inks" value={spec?.label ?? s.model} />
          <Spec label="Trim" value={`${s.aspect} · ${s.size}`} />
          <Spec label="Frames" value={String(s.variants)} />
        </div>
        <button
          type="button"
          onClick={() => (s.running ? s.stop() : void s.run())}
          className={`flex w-full items-center justify-center gap-1.5 border-t border-stock-rule py-2.5 text-[11px] font-bold tracking-[0.08em] transition-colors ${
            s.running ? "bg-ink text-stock" : "bg-ink text-stock hover:bg-cyan"
          }`}
        >
          {s.running ? <><Stop /> STOP · {done}/{s.frames.length}</> : "RUN"}
        </button>
      </div>
      <Handle type="source" position={Position.Right} className={dot} />
    </>
  );
}

function ProofNode() {
  const frames = useStore((s) => s.frames);
  const aspect = useStore((s) => s.aspect);
  return (
    <>
      <Handle type="target" position={Position.Left} className={dot} />
      <div className={PLATE}>
        <div className={PLATE_HEAD}>Proof</div>
        <div className="p-2.5">
          {frames.length ? (
            <div className="grid w-[260px] grid-cols-2 gap-1.5">
              {frames.map((frame) => (
                <div key={frame.index}
                  className="relative bg-stock-edge"
                  style={{ aspectRatio: aspect.replace(":", "/") }}>
                  {frame.url || frame.partial ? (
                    <img src={frame.url ?? frame.partial} alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      style={frame.url ? undefined : { filter: "blur(6px)" }} />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-ink-50">
                      <RegistrationTarget size={22} active={frame.status === "rendering"} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="w-[260px] text-[12px] text-ink-50">Nothing printed yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="legend text-ink-50">{label}</span>
      <span className="tabular truncate text-[11.5px]">{value}</span>
    </div>
  );
}

const nodeTypes = {
  concept: ConceptNode as unknown as React.ComponentType<NodeProps>,
  refs: RefsNode as unknown as React.ComponentType<NodeProps>,
  style: StyleNode as unknown as React.ComponentType<NodeProps>,
  press: PressNode as unknown as React.ComponentType<NodeProps>,
  proof: ProofNode as unknown as React.ComponentType<NodeProps>,
};

/** The Composer's state, laid out as plates. */
const INITIAL_NODES: Node[] = [
  { id: "concept", type: "concept", position: { x: 0, y: 40 }, data: {} },
  { id: "refs", type: "refs", position: { x: 0, y: 230 }, data: {} },
  { id: "style", type: "style", position: { x: 0, y: 380 }, data: {} },
  { id: "press", type: "press", position: { x: 330, y: 180 }, data: {} },
  { id: "proof", type: "proof", position: { x: 620, y: 150 }, data: {} },
];

const INITIAL_EDGES: Edge[] = [
  { id: "c-p", source: "concept", target: "press" },
  { id: "r-p", source: "refs", target: "press" },
  { id: "s-p", source: "style", target: "press" },
  { id: "p-o", source: "press", target: "proof" },
];

export function Canvas() {
  const running = useStore((s) => s.running);
  const [nodes, , onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  // Ink flows down the line only while the press is actually running.
  const styledEdges = useMemo(
    () => edges.map((edge) => ({
      ...edge,
      animated: running,
      style: { stroke: running ? "var(--color-magenta)" : "var(--color-surround-400)", strokeWidth: 1.5 },
    })),
    [edges, running],
  );

  return (
    <div className="min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: false }}
        className="[&_.react-flow__controls-button]:!border-surround-600 [&_.react-flow__controls-button]:!bg-surround-800 [&_.react-flow__controls-button]:!fill-stock"
      >
        <Background
          variant={BackgroundVariant.Cross}
          gap={28}
          size={4}
          color="var(--color-surround-600)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
