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
from zoneinfo import ZoneInfo

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
DOCREL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def clean(v: str | None) -> str | None:
    if v is None:
        return None
    s = v.strip()
    return s or None


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


def parse_comment_created_at(value: str | None) -> str | None:
    v = clean(value)
    if not v:
        return None
    for fmt in ("%d/%b/%Y %I:%M:%S %p", "%d/%B/%Y %I:%M:%S %p"):
        try:
            parsed = dt.datetime.strptime(v, fmt)
            parsed = parsed.replace(tzinfo=ZoneInfo("Asia/Jerusalem"))
            return parsed.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat()
        except ValueError:
            continue
    return None


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


def col_to_idx(col: str) -> int:
    value = 0
    for ch in col:
        value = value * 26 + (ord(ch.upper()) - 64)
    return value


def parse_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    out: list[str] = []
    for si in root.findall("main:si", NS):
        text_node = si.find("main:t", NS)
        if text_node is not None:
            out.append(text_node.text or "")
            continue
        out.append("".join((t.text or "") for t in si.findall(".//main:t", NS)))
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
        sheet = sheet_path_by_name(zf, sheet_name)
        root = ET.fromstring(zf.read(sheet))

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


class SupabaseRest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = f"{supabase_url.rstrip('/')}/rest/v1"
        self.service_role_key = service_role_key

    def _request(self, method: str, path: str, query: str = "", body=None, headers=None):
        url = f"{self.base}{path}{query}"
        req_headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
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

    def get(self, path: str, query: str = "", headers=None):
        return self._request("GET", path, query=query, headers=headers)

    def post(self, path: str, body, query: str = "", headers=None):
        return self._request("POST", path, query=query, body=body, headers=headers)

    def patch(self, path: str, body, query: str = "", headers=None):
        return self._request("PATCH", path, query=query, body=body, headers=headers)


def fetch_all_rows(api: SupabaseRest, table: str, select: str, page_size: int = 1000):
    rows = []
    query = f"?select={urllib.parse.quote(select, safe='*,()')}"
    for start in range(0, 1_000_000_000, page_size):
        data = api.get(
            f"/{table}",
            query=query,
            headers={"Range": f"{start}-{start + page_size - 1}"},
        )
        if not data:
            break
        rows.extend(data)
        if len(data) < page_size:
            break
    return rows


def chunked(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True, type=Path)
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--sheet-name", default="תגובות")
    args = parser.parse_args()

    env = parse_env_file(args.env)
    api = SupabaseRest(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

    people = fetch_all_rows(api, "people", "id,full_name,external_source_id")
    by_ext: dict[str, str] = {}
    by_name: dict[str, list[str]] = defaultdict(list)
    for p in people:
        pid = clean(p.get("id"))
        ext = clean(p.get("external_source_id"))
        name = clean(p.get("full_name"))
        if pid and ext:
            by_ext[ext] = pid
        if pid and name:
            by_name[name.lower()].append(pid)

    rows = read_sheet_rows(args.xlsx, args.sheet_name)
    mapped = []
    missing = 0
    ambiguous = 0
    for row in rows[1:]:
        row = row + [""] * max(0, 11 - len(row))
        item_id = normalize_legacy_id(row[0])
        item_name = clean(row[1])
        created_by_name = clean(row[4]) or "Legacy Import"
        created_at = parse_comment_created_at(row[5])
        content = clean(row[6])
        if not content or not created_at:
            continue

        person_id = by_ext.get(item_id or "")
        if not person_id and item_name:
            options = by_name.get(item_name.lower(), [])
            if len(options) == 1:
                person_id = options[0]
            elif len(options) > 1:
                ambiguous += 1

        if not person_id:
            missing += 1
            continue

        mapped.append(
            {
                "person_id": person_id,
                "content": content,
                "created_by_name": created_by_name,
                "created_at": created_at,
            }
        )

    null_notes = fetch_all_rows(api, "notes", "id,person_id,content,created_by_name,created_at")
    null_notes = [n for n in null_notes if n.get("created_at") is None]

    null_by_key: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for note in null_notes:
        key = (
            clean(note.get("person_id")) or "",
            clean(note.get("content")) or "",
            clean(note.get("created_by_name")) or "",
        )
        nid = clean(note.get("id"))
        if nid:
            null_by_key[key].append(nid)

    source_by_key: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for row in mapped:
        key = (row["person_id"], row["content"], row["created_by_name"])
        source_by_key[key].append(row["created_at"])

    updates = []
    for key, note_ids in null_by_key.items():
        ts_list = sorted(source_by_key.get(key, []))
        if not ts_list:
            continue
        limit = min(len(note_ids), len(ts_list))
        for i in range(limit):
            updates.append({"id": note_ids[i], "created_at": ts_list[i]})

    for row in updates:
        note_id = row["id"]
        created_at = row["created_at"]
        api.patch(
            "/notes",
            body={"created_at": created_at},
            query=f"?id=eq.{urllib.parse.quote(note_id)}",
            headers={"Prefer": "return=minimal"},
        )

    print("Backfill summary:")
    print(f"- mapped comments with parsed timestamps: {len(mapped)}")
    print(f"- skipped in mapping (missing person): {missing}")
    print(f"- skipped in mapping (ambiguous name): {ambiguous}")
    print(f"- notes with null created_at before matching: {len(null_notes)}")
    print(f"- notes updated with timestamps: {len(updates)}")


if __name__ == "__main__":
    main()
