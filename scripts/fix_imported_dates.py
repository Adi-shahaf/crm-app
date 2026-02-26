#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import decimal
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
DOCREL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return v if v else None


def normalize_legacy_id(value: str | None) -> str | None:
    v = clean(value)
    if not v:
        return None
    try:
        d = decimal.Decimal(v)
        if d == d.to_integral_value():
            return str(int(d))
    except decimal.InvalidOperation:
        pass
    return v


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def col_to_idx(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def parse_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    out: list[str] = []
    for si in root.findall("main:si", NS):
        t = si.find("main:t", NS)
        if t is not None:
            out.append(t.text or "")
        else:
            out.append("".join((x.text or "") for x in si.findall(".//main:t", NS)))
    return out


def sheet_path_by_name(zf: zipfile.ZipFile, sheet_name: str) -> str:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall("rel:Relationship", NS)}
    for sheet in wb.findall("main:sheets/main:sheet", NS):
        if sheet.attrib.get("name") == sheet_name:
            target = rel_map[sheet.attrib[DOCREL]]
            if target.startswith("/"):
                return target.lstrip("/")
            return target if target.startswith("xl/") else f"xl/{target}"
    raise RuntimeError(f"Sheet not found: {sheet_name}")


def excel_cell_value(cell: ET.Element, shared: list[str]) -> str:
    typ = cell.attrib.get("t")
    v_node = cell.find("main:v", NS)
    if v_node is None:
        inline = cell.find("main:is/main:t", NS)
        return (inline.text or "").strip() if inline is not None else ""
    raw = (v_node.text or "").strip()
    if typ == "s":
        try:
            return shared[int(raw)].strip()
        except Exception:
            return raw
    return raw


def read_sheet_rows(path: Path, sheet_name: str) -> list[list[str]]:
    with zipfile.ZipFile(path) as zf:
        shared = parse_shared_strings(zf)
        sheet_path = sheet_path_by_name(zf, sheet_name)
        root = ET.fromstring(zf.read(sheet_path))

    rows: list[list[str]] = []
    max_col = 0
    for row in root.findall("main:sheetData/main:row", NS):
        values: dict[int, str] = {}
        for cell in row.findall("main:c", NS):
            ref = cell.attrib.get("r", "")
            m = re.match(r"([A-Z]+)(\d+)", ref)
            if not m:
                continue
            idx = col_to_idx(m.group(1))
            values[idx] = excel_cell_value(cell, shared)
            max_col = max(max_col, idx)
        rows.append([values.get(i, "").strip() for i in range(1, max_col + 1)])
    return rows


def excel_serial_to_iso(value: str | None) -> str | None:
    v = clean(value)
    if not v or "YYYY-" in v:
        return None
    try:
        serial = float(v)
    except ValueError:
        return None
    epoch = dt.datetime(1899, 12, 30, tzinfo=dt.timezone.utc)
    parsed = epoch + dt.timedelta(days=serial)
    if abs(serial - round(serial)) < 1e-9:
        parsed = parsed.replace(hour=0, minute=0, second=0, microsecond=0)
    return parsed.replace(microsecond=0).isoformat()


class SupabaseRest:
    def __init__(self, supabase_url: str, service_key: str):
        self.base = f"{supabase_url.rstrip('/')}/rest/v1"
        self.service_key = service_key

    def _request(
        self,
        method: str,
        path: str,
        query: str = "",
        body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        url = f"{self.base}{path}{query}"
        req_headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
        }
        if headers:
            req_headers.update(headers)
        payload = None
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            req_headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url=url, data=payload, method=method, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as err:
            message = err.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {err.code} {path}{query}: {message}") from err
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))

    def get(self, path: str, query: str = "", headers: dict[str, str] | None = None) -> Any:
        return self._request("GET", path, query=query, headers=headers)

    def patch(self, path: str, body: Any, query: str = "", headers: dict[str, str] | None = None) -> Any:
        return self._request("PATCH", path, query=query, body=body, headers=headers)


def fetch_all_rows(api: SupabaseRest, table: str, select: str, page_size: int = 1000) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    query = f"?select={urllib.parse.quote(select, safe='*,()')}"
    for start in range(0, 1_000_000_000, page_size):
        rows = api.get(
            f"/{table}",
            query=query,
            headers={"Range": f"{start}-{start + page_size - 1}"},
        )
        if not rows:
            break
        out.extend(rows)
        if len(rows) < page_size:
            break
    return out


def mapping_from_roshi(rows: list[list[str]]) -> tuple[dict[str, str], int]:
    if len(rows) < 3:
        return {}, 0
    header = rows[1]
    idx: dict[str, int] = {name.strip(): i for i, name in enumerate(header) if name.strip()}
    ext_i = idx.get("Item ID (auto generated)")
    date_i = idx.get("תאריך ושעה")
    if ext_i is None or date_i is None:
        return {}, 0

    mapping: dict[str, str] = {}
    masked_count = 0
    for row in rows[2:]:
        row = row + [""] * 32
        name = clean(row[idx.get("Name", 0)])
        if not name or name in {"Name", "Services"}:
            continue
        external = normalize_legacy_id(row[ext_i])
        if not external:
            continue
        raw_date = clean(row[date_i])
        if raw_date and "YYYY-" in raw_date:
            masked_count += 1
        parsed = excel_serial_to_iso(raw_date)
        if parsed:
            mapping[external] = parsed
    return mapping, masked_count


def mapping_from_atias(rows: list[list[str]]) -> dict[str, str]:
    header_row_idx = None
    for i, row in enumerate(rows):
        if "Name" in row and "Item ID (auto generated)" in row:
            header_row_idx = i
            break
    if header_row_idx is None:
        return {}

    header = rows[header_row_idx]
    idx: dict[str, int] = {name.strip(): i for i, name in enumerate(header) if name.strip()}
    ext_i = idx.get("Item ID (auto generated)")
    date_i = idx.get("תאריך ושעה")
    name_i = idx.get("Name")
    if ext_i is None or date_i is None or name_i is None:
        return {}

    mapping: dict[str, str] = {}
    for row in rows[header_row_idx + 1 :]:
        row = row + [""] * 32
        if clean(row[0]) and sum(1 for v in row if clean(v)) == 1:
            continue
        if clean(row[name_i]) in {"", "Name"}:
            continue
        external = normalize_legacy_id(row[ext_i])
        parsed = excel_serial_to_iso(row[date_i])
        if external and parsed:
            mapping[external] = parsed
    return mapping


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True, type=Path)
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    env = parse_env_file(args.env)
    api = SupabaseRest(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

    roshi_rows = read_sheet_rows(args.xlsx, "ראשי")
    atias_rows = read_sheet_rows(args.xlsx, "אטיאס")
    roshi_map, roshi_masked = mapping_from_roshi(roshi_rows)
    atias_map = mapping_from_atias(atias_rows)

    date_by_external = dict(roshi_map)
    date_by_external.update(atias_map)

    people = fetch_all_rows(api, "people", "id,external_source_id,created_at")
    people_by_external: dict[str, dict[str, Any]] = {}
    for row in people:
        ext = clean(row.get("external_source_id"))
        if ext:
            people_by_external[ext] = row

    updates: list[tuple[str, str]] = []
    for ext, iso_date in date_by_external.items():
        person = people_by_external.get(ext)
        if not person:
            continue
        current_created = clean(person.get("created_at"))
        if current_created and current_created.startswith(iso_date[:10]):
            continue
        updates.append((person["id"], iso_date))

    null_notes = fetch_all_rows(api, "notes", "id,person_id,created_at")
    people_by_id = {row["id"]: clean(row.get("created_at")) for row in people if clean(row.get("id"))}
    note_updates: list[tuple[str, str]] = []
    for note in null_notes:
        if note.get("created_at") is not None:
            continue
        pid = clean(note.get("person_id"))
        nid = clean(note.get("id"))
        if not pid or not nid:
            continue
        person_created = people_by_id.get(pid)
        if person_created:
            note_updates.append((nid, person_created))

    print("Date fix plan:")
    print(f"- parsed dates from 'ראשי': {len(roshi_map)}")
    print(f"- masked (unrecoverable) dates in 'ראשי': {roshi_masked}")
    print(f"- parsed dates from 'אטיאס': {len(atias_map)}")
    print(f"- people created_at updates: {len(updates)}")
    print(f"- notes null created_at backfill updates: {len(note_updates)}")

    if args.dry_run:
        return

    for person_id, iso_date in updates:
        api.patch(
            "/people",
            body={"created_at": iso_date},
            query=f"?id=eq.{urllib.parse.quote(person_id)}",
            headers={"Prefer": "return=minimal"},
        )

    for note_id, iso_date in note_updates:
        api.patch(
            "/notes",
            body={"created_at": iso_date},
            query=f"?id=eq.{urllib.parse.quote(note_id)}",
            headers={"Prefer": "return=minimal"},
        )

    print("\nApplied:")
    print(f"- people updated: {len(updates)}")
    print(f"- notes updated: {len(note_updates)}")


if __name__ == "__main__":
    main()
