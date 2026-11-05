/**
 * Just enough DOM for the hosted renderers under vitest's node environment.
 * Test-only; not imported by the bundle.
 */
import { vi } from "vitest";

type Listener = (event: { key?: string }) => void;

export class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  attributes: Record<string, string> = {};
  listeners: Record<string, Listener> = {};
  style: Record<string, string> = {};
  className = "";
  id = "";
  innerHTML = "";
  value = "";
  hidden = false;
  disabled = false;
  focused = false;
  selected = false;
  private text = "";
  constructor(public tag: string) {}
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; if (key === "id") this.id = value; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  appendChild(node: FakeNode) { node.parent?.removeChild(node); node.parent = this; this.children.push(node); return node; }
  removeChild(node: FakeNode) { this.children = this.children.filter((child) => child !== node); node.parent = null; }
  replaceChildren(...nodes: FakeNode[]) { for (const child of this.children) child.parent = null; this.children = []; nodes.forEach((node) => this.appendChild(node)); }
  remove() { this.parent?.removeChild(this); }
  replaceWith(node: FakeNode) {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    node.parent?.removeChild(node);
    parent.children[index] = node;
    node.parent = parent;
    this.parent = null;
  }
  addEventListener(event: string, listener: Listener) { this.listeners[event] = listener; }
  closest() { return null; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  click() { this.listeners.click?.({}); }
}

export function descendants(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(descendants)];
}

/** Stub document/window/navigator and return the #root host. */
export function installDom(options: { bootstrap: Record<string, unknown>; userAgent?: string; clipboard?: { writeText: (text: string) => Promise<void> } }) {
  const host = new FakeNode("body");
  const root = new FakeNode("div");
  root.id = "root";
  host.appendChild(root);
  const head = new FakeNode("head");
  const assign = vi.fn();
  vi.stubGlobal("document", {
    createElement: (tag: string) => new FakeNode(tag),
    head,
    getElementById: (id: string) => id === "root" ? root : [...descendants(host), ...descendants(head)].find((node) => node.id === id) ?? null,
  });
  vi.stubGlobal("window", {
    location: { assign, href: "https://mira.auth.example/sign-in?redirect_uri=https%3A%2F%2Fapp.example%2Fcb&state=s" },
    __KOVA_AUTH_HOSTED__: options.bootstrap,
  });
  vi.stubGlobal("navigator", { userAgent: options.userAgent ?? "", clipboard: options.clipboard });
  return { host, root, head, assign, all: () => descendants(host) };
}

export function byText(nodes: FakeNode[], tag: string, text: string): FakeNode | undefined {
  return nodes.find((node) => node.tag === tag && node.textContent === text);
}
