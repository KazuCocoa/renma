const SECTION_ID = "renma-operational-metadata-table";
const TABLE_CLASS = "renma-metadata-table";
const SHELL_CLASS = "renma-metadata-table-shell";
const SHELL_LABEL = "Renma operational metadata table";

function findSectionTable(heading: HTMLElement): HTMLTableElement | undefined {
  const sectionMatch = /^H([1-6])$/.exec(heading.tagName);
  if (sectionMatch === null) return undefined;
  const sectionLevel = Number(sectionMatch[1]);

  let sibling = heading.nextElementSibling;
  while (sibling !== null) {
    const siblingMatch = /^H([1-6])$/.exec(sibling.tagName);
    if (siblingMatch !== null && Number(siblingMatch[1]) <= sectionLevel) {
      return undefined;
    }

    if (sibling.tagName === "TABLE") return sibling as HTMLTableElement;
    const nestedTable = sibling.querySelector<HTMLTableElement>("table");
    if (nestedTable !== null) return nestedTable;

    sibling = sibling.nextElementSibling;
  }

  return undefined;
}

/** Progressively enhances the authoritative Markdown metadata table. */
export function enhanceOperationalMetadataTable(
  root: ParentNode = document,
): void {
  const heading = root.querySelector<HTMLElement>(`#${SECTION_ID}`);
  if (heading === null) return;

  const table = findSectionTable(heading);
  if (table === undefined) return;

  table.classList.add(TABLE_CLASS);

  let shell: HTMLElement;
  if (table.parentElement?.classList.contains(SHELL_CLASS) === true) {
    shell = table.parentElement;
  } else {
    shell = heading.ownerDocument.createElement("div");
    shell.className = SHELL_CLASS;
    table.parentNode?.insertBefore(shell, table);
    shell.append(table);
  }

  shell.setAttribute("role", "region");
  shell.setAttribute("aria-label", SHELL_LABEL);
  shell.id = `${SECTION_ID}-region`;
  shell.tabIndex = 0;

  const headerCells = Array.from(
    table.tHead?.rows[0]?.cells ?? [],
  ) as HTMLTableCellElement[];
  const headers = headerCells.map((header, index) => {
    const id = `${SECTION_ID}-column-${index + 1}`;
    header.id = id;
    header.scope = "col";
    return {
      id,
      label: header.textContent?.trim() ?? "",
    };
  });

  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      for (const cell of Array.from(row.cells)) {
        if (cell.tagName !== "TD") continue;

        const header = headers[cell.cellIndex];
        if (header === undefined) continue;
        cell.setAttribute("headers", header.id);
        cell.dataset.label = header.label;
      }
    }
  }
}
