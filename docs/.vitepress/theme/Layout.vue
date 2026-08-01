<script setup lang="ts">
import type { Mermaid } from "mermaid";
import DefaultTheme from "vitepress/theme";
import { useRoute } from "vitepress";
import { nextTick, onMounted, watch } from "vue";

import { mermaidConfig } from "../mermaid.js";

interface DiagramSource {
  element: HTMLElement;
  source: string;
  index: number;
}

const { Layout } = DefaultTheme;
const route = useRoute();

let mermaidPromise: Promise<Mermaid> | undefined;
let renderQueue = Promise.resolve();

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize(mermaidConfig);
    return mermaid;
  });
  return mermaidPromise;
}

function markRenderFailure(diagram: DiagramSource, error: unknown): void {
  diagram.element.textContent = diagram.source;
  diagram.element.removeAttribute("data-processed");
  diagram.element.dataset.mermaidError = "true";
  diagram.element
    .closest(".mermaid-container")
    ?.classList.add("mermaid-render-error");

  console.error(
    `[Mermaid] Failed to render diagram ${diagram.index + 1} on ${window.location.pathname}.`,
    error,
  );
}

async function renderMermaidDiagrams(): Promise<void> {
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".mermaid-container .mermaid:not([data-processed]):not([data-mermaid-error])",
    ),
  );
  if (elements.length === 0) return;

  const diagrams = elements.map((element, index) => ({
    element,
    source: element.textContent ?? "",
    index,
  }));

  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    diagrams.forEach((diagram) => markRenderFailure(diagram, error));
    return;
  }

  const validDiagrams: DiagramSource[] = [];
  for (const diagram of diagrams) {
    try {
      await mermaid.parse(diagram.source);
      validDiagrams.push(diagram);
    } catch (error) {
      markRenderFailure(diagram, error);
    }
  }

  if (validDiagrams.length === 0) return;

  let renderError: unknown;
  try {
    await mermaid.run({
      nodes: validDiagrams.map(({ element }) => element),
    });
  } catch (error) {
    renderError = error;
  }

  for (const diagram of validDiagrams) {
    if (diagram.element.querySelector(":scope > svg") !== null) continue;
    markRenderFailure(
      diagram,
      renderError ?? new Error("Mermaid did not produce an SVG."),
    );
  }
}

function scheduleMermaidRender(): void {
  renderQueue = renderQueue
    .then(async () => {
      await nextTick();
      await renderMermaidDiagrams();
    })
    .catch((error: unknown) => {
      console.error("[Mermaid] Unexpected rendering failure.", error);
    });
}

onMounted(scheduleMermaidRender);
watch(() => route.path, scheduleMermaidRender, { flush: "post" });
</script>

<template>
  <Layout />
</template>
