import re

_COLUMN_SPLIT = re.compile(r"\t+| {2,}")


def normalize_tables(text: str) -> str:
    """Convert tab/space-aligned pseudo-tables the model sometimes emits into
    real GitHub-Flavored Markdown tables, so they render as tables in the UI
    instead of raw unaligned text."""
    lines = text.split("\n")
    out: list[str] = []
    i = 0

    while i < len(lines):
        block, row_count = _read_tabular_block(lines, i)
        if row_count >= 2:
            out.extend(_render_table(block))
            i += row_count
        else:
            out.append(lines[i])
            i += 1

    return "\n".join(out)


def _read_tabular_block(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    rows: list[list[str]] = []
    i = start
    ncols = None

    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith(("|", "-", "*", "#")):
            break
        fields = [f.strip() for f in _COLUMN_SPLIT.split(line.strip())]
        if len(fields) < 2:
            break
        if ncols is None:
            ncols = len(fields)
        elif len(fields) != ncols:
            break
        rows.append(fields)
        i += 1

    return rows, len(rows)


def _render_table(rows: list[list[str]]) -> list[str]:
    header, *body = rows
    ncols = len(header)
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * ncols) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return lines
