from __future__ import annotations
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

def _a1_to_rc(a1: str) -> Tuple[int, int]:
    a1 = a1.strip().upper()
    i = 0
    col = 0
    while i < len(a1) and a1[i].isalpha():
        col = col * 26 + (ord(a1[i]) - ord('A') + 1)
        i += 1
    if i == 0 or i >= len(a1):
        raise ValueError(f"Invalid A1 reference: {a1}")
    row = int(a1[i:])
    return row, col

def _rc_to_a1(row: int, col: int) -> str:
    if row < 1 or col < 1:
        raise ValueError("row and col must be >= 1")
    s = ""
    c = col
    while c:
        c, rem = divmod(c - 1, 26)
        s = chr(ord('A') + rem) + s
    return f"{s}{row}"

def _parse_ref(ref: str) -> Tuple[Tuple[int, int], Tuple[int, int]]:
    ref = ref.replace("$", "").strip()
    if ":" not in ref:
        rc = _a1_to_rc(ref)
        return rc, rc
    left, right = ref.split(":", 1)
    r1, c1 = _a1_to_rc(left)
    r2, c2 = _a1_to_rc(right)
    if r2 < r1 or c2 < c1:
        r1, r2 = min(r1, r2), max(r1, r2)
        c1, c2 = min(c1, c2), max(c1, c2)
    return (r1, c1), (r2, c2)

@dataclass
class Cell:
    value: Any
    formula: Optional[str] = None
    number_format: Optional[str] = None
    hyperlink: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Cell":
        return cls(
            value=d.get("value"),
            formula=d.get("formula"),
            number_format=d.get("number_format"),
            hyperlink=d.get("hyperlink"),
        )

    def as_dict(self) -> Dict[str, Any]:
        return {
            "value": self.value,
            "formula": self.formula,
            "number_format": self.number_format,
            "hyperlink": self.hyperlink,
        }

class ROIWorkbook:
    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._sheets_by_name: Dict[str, Dict[str, Any]] = {}
        self._cells_by_sheet: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._tables_index: List[Dict[str, Any]] = []
        for sheet in data.get("sheets", []):
            name = sheet["name"]
            self._sheets_by_name[name] = sheet
            self._cells_by_sheet[name] = sheet.get("cells", {})
            for t in sheet.get("tables", []) or []:
                self._tables_index.append({
                    "sheet": name,
                    "name": t.get("name"),
                    "ref": t.get("ref"),
                    "columns": t.get("columns"),
                })

    @classmethod
    def from_file(cls, path: str | Path) -> "ROIWorkbook":
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(data)

    @classmethod
    def from_json(cls, data: Dict[str, Any]) -> "ROIWorkbook":
        return cls(data)

    def list_sheets(self) -> List[str]:
        return list(self._sheets_by_name.keys())

    def sheet_info(self, sheet: str) -> Dict[str, Any]:
        s = self._sheets_by_name.get(sheet)
        if not s:
            raise KeyError(f"Sheet not found: {sheet}")
        return {
            "name": s["name"],
            "max_row": s.get("max_row"),
            "max_column": s.get("max_column"),
            "merged_ranges": s.get("merged_ranges", []),
        }

    def get_cell(self, sheet: str, a1: str) -> Optional[Dict[str, Any]]:
        cells = self._cells_by_sheet.get(sheet)
        if cells is None:
            raise KeyError(f"Sheet not found: {sheet}")
        d = cells.get(a1.upper())
        return d.copy() if d else None

    def set_cell_value(self, sheet: str, a1: str, value: Any) -> None:
        cells = self._cells_by_sheet.get(sheet)
        if cells is None:
            raise KeyError(f"Sheet not found: {sheet}")
        a1 = a1.upper()
        if a1 not in cells:
            cells[a1] = {"value": value, "formula": None, "number_format": None}
        else:
            cells[a1]["value"] = value

    def iter_used_cells(self, sheet: str):
        cells = self._cells_by_sheet.get(sheet)
        if cells is None:
            raise KeyError(f"Sheet not found: {sheet}")
        for a1, d in cells.items():
            yield a1, d

    def get_range(self, sheet: str, top_left: str, bottom_right: str):
        cells = self._cells_by_sheet.get(sheet)
        if cells is None:
            raise KeyError(f"Sheet not found: {sheet}")
        (r1, c1), (r2, c2) = _parse_ref(f"{top_left}:{bottom_right}")
        grid = []
        for r in range(r1, r2 + 1):
            row_list = []
            for c in range(c1, c2 + 1):
                a1 = _rc_to_a1(r, c)
                d = cells.get(a1)
                if d is None:
                    d = {"value": None, "formula": None, "number_format": None}
                row_list.append(d.copy())
            grid.append(row_list)
        return grid

    def list_tables(self, sheet: Optional[str] = None) -> List[Dict[str, Any]]:
        items = self._tables_index
        if sheet:
            return [t for t in items if t["sheet"] == sheet]
        return items.copy()

    def get_table(self, name: str, sheet: Optional[str] = None) -> Dict[str, Any]:
        for t in self._tables_index:
            if t["name"] == name and (sheet is None or t["sheet"] == sheet):
                return t.copy()
        raise KeyError(f"Table not found: {name}")

    def get_table_rows(self, name: str, sheet: Optional[str] = None, header: bool = True):
        t = self.get_table(name, sheet)
        (r1, c1), (r2, c2) = _parse_ref(t["ref"])
        grid = self.get_range(t["sheet"], _rc_to_a1(r1, c1), _rc_to_a1(r2, c2))
        headers = t.get("columns")
        values_grid = [[(cell or {}).get("value") for cell in row] for row in grid]
        if not headers:
            header_row = None
            for row in values_grid:
                if any(v is not None and v != "" for v in row):
                    header_row = row
                    break
            if header_row is None:
                headers = [f"Col{idx+1}" for idx in range(len(values_grid[0]) if values_grid else 0)]
                data_rows = values_grid
            else:
                headers = [str(h) if h not in (None, "") else f"Col{idx+1}" for idx, h in enumerate(header_row)]
                data_rows = values_grid[1:]
        else:
            data_rows = values_grid[1:] if header else values_grid
        out = []
        for row in data_rows:
            row_dict = {}
            for i, h in enumerate(headers):
                key = str(h)
                row_dict[key] = row[i] if i < len(row) else None
            out.append(row_dict)
        return out

    def find_sources(self) -> List[Dict[str, Any]]:
        return self._data.get("sources_detected", []).copy()

    def to_json(self) -> Dict[str, Any]:
        for sheet in self._data.get("sheets", []):
            name = sheet["name"]
            sheet["cells"] = self._cells_by_sheet.get(name, {})
        return json.loads(json.dumps(self._data))

    def save(self, path: str | Path) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_json(), f, ensure_ascii=False, indent=2)
