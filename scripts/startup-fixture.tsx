// Browser-only lifecycle fixture, never imported by the production app.
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  StartupController,
  StartupState,
} from "../src/startup/controller";
import Graph from "../src/components/Graph";
import { Exploration } from "../src/interaction/exploration";
import { subjects, type Snapshot } from "../src/types";
import "../src/styles.css";
import "../src/startup/startup.css";

export function mountWorkspace(
  controller: StartupController,
  state: StartupState,
  options: {
    strict?: boolean;
    collapsed?: boolean;
    empty?: boolean;
    welcome?: boolean;
    drawer?: boolean;
    dense?: boolean;
  } = {},
) {
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  const organization: Snapshot["organization"] = {
    schema_version: 1,
    neurons: [{ id: "study", name: "Study workspace", path: "study" }],
    subjects: subjects.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      preset: s.id,
      neuron_id: "study",
      root: null,
      legacy: false,
    })),
    location: { neuron_id: null, subject_id: options.dense ? "physics" : null },
    fallback_subject: "general",
  };
  const notes = Array.from({ length: options.dense ? 300 : 15 }, (_, i) => ({
    id: `note-${i}`,
    title: `Study note ${i}`,
    subject: options.dense ? "physics" : subjects[i % 5].id,
    subject_id: options.dense ? "physics" : subjects[i % 5].id,
    neuron_id: "study",
    revision: "fixture",
    neighbors: 4,
  }));
  const snapshot: Snapshot = {
    root: "fixture",
    name: "Synapse demo",
    organization,
    notes: options.empty ? [] : notes,
    edges: options.empty
      ? []
      : notes
          .slice(0, -1)
          .map((n, i) => ({ source: n.id, target: notes[i + 1].id })),
    links: [],
    cards: [],
    history: { schema_version: 1, cards: {} },
    warnings: [],
    review_error: null,
  };
  if (options.empty) snapshot.organization.subjects = [];
  const exploration = new Exploration();
  exploration.sync(snapshot);
  let makeReady = () => {};
  function Workspace() {
    const main = useRef<HTMLElement>(null),
      drawer = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(state.ready);
    useLayoutEffect(() => {
      makeReady = () => setReady(true);
      return controller.attach(main.current!);
    }, []);
    useLayoutEffect(() => controller.update({ ...state, ready }), [ready]);
    return (
      <main
        ref={main}
        className="app"
        data-motion={state.reduced ? "reduced" : "full"}
      >
        {!ready ? (
          <div className="startup-restoring" role="status">
            Restoring your workspace…
          </div>
        ) : options.welcome ? (
          <div className="welcome">
            <h1 data-swarm="text">Synapse 👩🏽‍💻</h1>
            <button id="first" data-swarm="box">
              Open vault
            </button>
            <p>Choose a folder of Markdown notes</p>
            <button data-swarm="box">Preferences</button>
          </div>
        ) : (
          <>
            <aside
              className={`sidebar glass ${options.collapsed ? "collapsed" : ""}`}
              data-swarm-surface=""
            >
              <header className="sidebar-head">
                <span className="brand" data-swarm="text">
                  {options.collapsed ? "S" : "Synapse"}
                </span>
                <button data-swarm="box">‹</button>
              </header>
              {!options.collapsed && (
                <>
                  <div className="vault-heading" data-swarm="box">
                    Synapse demo
                  </div>
                  <label className="search" data-swarm="box">
                    <input placeholder="Search notes" />
                  </label>
                </>
              )}
              <button id="first" className="new-note" data-swarm="box">
                {options.collapsed ? "+" : "New note"}
              </button>
              {!options.collapsed && (
                <nav className="hierarchy">
                  <button className="all-row selected" data-swarm="duplicate">
                    All Neurons
                  </button>
                  <div className="tree-row neuron-row" data-swarm="box">
                    Study workspace
                  </div>
                  {subjects.map((s) => (
                    <div
                      key={s.id}
                      className="tree-row subject-row"
                      data-swarm="duplicate"
                    >
                      <span
                        className="subject-dot"
                        style={{ background: s.color }}
                      />
                      {s.short}
                    </div>
                  ))}
                </nav>
              )}
              <div className="sidebar-actions" data-swarm="box">
                <button>New Neuron</button>
                <button>New subject</button>
                <button>Import subject</button>
              </div>
              <footer className="sidebar-footer" data-swarm="box">
                Review
              </footer>
            </aside>
            <Graph
              snapshot={snapshot}
              exploration={exploration}
              onNavigate={() => {}}
              query=""
              left={options.collapsed ? 80 : 312}
              drawer={drawer}
              editorWidth={430}
              auxiliaryOpen={options.drawer}
              onOpen={() => {}}
              onNewNote={() => {}}
            />
            {options.drawer && (
              <div ref={drawer} className="editor-drawer">
                <section className="editor-panel" style={{ width: 430 }}>
                  <header className="editor-header" data-swarm="box">
                    Study note
                  </header>
                  <textarea
                    id="draft"
                    aria-label="Unsaved draft"
                    defaultValue={"Unsaved study draft\n".repeat(40)}
                    style={{ height: 500, width: "100%" }}
                  />
                </section>
              </div>
            )}
          </>
        )}
      </main>
    );
  }
  root.render(
    options.strict ? (
      <StrictMode>
        <Workspace />
      </StrictMode>
    ) : (
      <Workspace />
    ),
  );
  return {
    ready: () => makeReady(),
    exploration,
    unmount: () => {
      root.unmount();
      host.remove();
    },
  };
}
export function mountStrict(
  controller: StartupController,
  target: HTMLElement,
  state: StartupState,
) {
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  function Fixture() {
    useLayoutEffect(() => {
      const detach = controller.attach(target);
      controller.update(state);
      return detach;
    }, []);
    return null;
  }
  root.render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  return () => {
    root.unmount();
    host.remove();
  };
}
