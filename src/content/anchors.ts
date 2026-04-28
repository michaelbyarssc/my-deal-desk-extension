// Anchor resolution — given a FieldAnchor from a field map, find the actual
// DOM element on the page. Adapters call this rather than working with
// document.querySelector directly, so anchoring strategies can evolve
// without rewriting every adapter.

import type { FieldAnchor } from "@/types/fieldMap";

export const findElement = (anchor: FieldAnchor, root: Document | HTMLElement = document): HTMLElement | null => {
  switch (anchor.by) {
    case "id":
      return (root as Document).getElementById?.(anchor.value) ?? root.querySelector<HTMLElement>(`#${CSS.escape(anchor.value)}`);

    case "name":
      return root.querySelector<HTMLElement>(`[name="${CSS.escape(anchor.value)}"]`);

    case "selector":
      return root.querySelector<HTMLElement>(anchor.value);

    case "labelText": {
      // Try standard <label for="X">text</label> first.
      const labels = Array.from(root.querySelectorAll("label"));
      const target = anchor.value.toLowerCase().trim();
      const label = labels.find((l) => l.textContent?.trim().toLowerCase() === target);
      if (label) {
        const forId = label.getAttribute("for");
        if (forId) {
          const byFor = (root as Document).getElementById?.(forId);
          if (byFor) return byFor;
        }
        const inside = label.querySelector<HTMLElement>("input, select, textarea");
        if (inside) return inside;
      }

      // Paragon-style: label is a sibling cell, not an actual <label>. Walk
      // text-bearing nodes and find the matching one, then look for an input
      // in the same row.
      const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim().toLowerCase();
        if (text === target) {
          let parent: HTMLElement | null = node.parentElement;
          // Walk up a few levels looking for an input/select/textarea sibling.
          for (let depth = 0; depth < 6 && parent; depth++) {
            const inp = parent.querySelector<HTMLElement>("input, select, textarea");
            if (inp) return inp;
            parent = parent.parentElement;
          }
        }
      }
      return null;
    }
  }
};

/** Resolve every part of a multipart anchor. Used by multipart_thousands etc. */
export const findParts = (
  parts: Record<string, FieldAnchor>,
  root: Document | HTMLElement = document,
): Record<string, HTMLElement | null> => {
  const out: Record<string, HTMLElement | null> = {};
  for (const [key, anchor] of Object.entries(parts)) {
    out[key] = findElement(anchor, root);
  }
  return out;
};
