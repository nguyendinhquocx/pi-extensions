export interface ParentNode {
  id: string;
  parentId: string | null;
}
export interface Hierarchy<T extends ParentNode> {
  nodes: Map<string, T>;
  children: Map<string, T[]>;
  roots: T[];
}
export interface HierarchyRow<T> {
  node: T;
  depth: number;
  childCount: number;
}
export function hierarchy<T extends ParentNode>(items: T[]): Hierarchy<T> {
  const nodes = new Map(items.map((node) => [node.id, node]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const node of items) {
    if (!node.parentId || !nodes.has(node.parentId)) roots.push(node);
    else {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }
  // Malformed rootless cycles remain inspectable; original parent IDs are never rewritten.
  const reached = new Set<string>();
  const stack = roots.slice();
  const visit = () => {
    while (stack.length) {
      const node = stack.pop();
      if (!node || reached.has(node.id)) continue;
      reached.add(node.id);
      stack.push(...(children.get(node.id) ?? []));
    }
  };
  visit();
  for (const node of items)
    if (!reached.has(node.id)) {
      roots.push(node);
      stack.push(node);
      visit();
    }
  return { nodes, children, roots };
}
export function ancestors<T extends ParentNode>(tree: Hierarchy<T>, id: string): string[] {
  const result: string[] = [];
  const seen = new Set([id]);
  let parent = tree.nodes.get(id)?.parentId;
  while (parent && tree.nodes.has(parent) && !seen.has(parent)) {
    seen.add(parent);
    result.push(parent);
    parent = tree.nodes.get(parent)?.parentId;
  }
  return result;
}
export function withAncestors<T extends ParentNode>(tree: Hierarchy<T>, matches: Set<string>): Set<string> {
  const keep = new Set(matches);
  // Each parent edge is visited once even for very long linear histories.
  for (const id of matches) {
    let current = tree.nodes.get(id)?.parentId;
    const seen = new Set([id]);
    while (current && tree.nodes.has(current) && !seen.has(current)) {
      seen.add(current);
      if (keep.has(current)) break;
      keep.add(current);
      current = tree.nodes.get(current)?.parentId;
    }
  }
  return keep;
}
export function flatten<T extends ParentNode>(
  tree: Hierarchy<T>,
  expanded: Set<string>,
  keep?: Set<string>,
): HierarchyRow<T>[] {
  const rows: HierarchyRow<T>[] = [];
  const seen = new Set<string>();
  const stack = tree.roots
    .slice()
    .reverse()
    .map((node) => ({ node, depth: 0 }));
  while (stack.length) {
    const row = stack.pop();
    if (!row || seen.has(row.node.id) || (keep && !keep.has(row.node.id))) continue;
    seen.add(row.node.id);
    const children = (tree.children.get(row.node.id) ?? []).filter((node) => !keep || keep.has(node.id));
    rows.push({ ...row, childCount: children.length });
    if (expanded.has(row.node.id))
      for (const node of children.slice().reverse()) stack.push({ node, depth: row.depth + 1 });
  }
  return rows;
}
export function reveal<T extends ParentNode>(tree: Hierarchy<T>, expanded: Set<string>, id: string): Set<string> {
  return new Set([...expanded, ...ancestors(tree, id)]);
}
export function label(node: { kind: string; name?: string; label: string }): string {
  if (node.name) return node.name;
  if (node.label && !/^[[{]/.test(node.label.trim())) return node.label;
  switch (node.kind) {
    case "context_edit":
      return "Context contribution updated";
    case "compaction":
      return "Compaction checkpoint";
    case "branch_summary":
      return "Branch summary";
    case "custom":
      return "Custom session entry";
    case "label":
      return "Entry label updated";
    case "session_info":
      return "Session metadata";
    default:
      return "Recorded session entry";
  }
}
