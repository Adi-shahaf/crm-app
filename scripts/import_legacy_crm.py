#!/usr/bin/env python3
"""
Import legacy CRM xlsx into Supabase tables:
- people (items)
- notes (comments, from WhatsApp response column H)
- purchases (services)

Usage:
  python3 scripts/import_legacy_crm.py \
    --xlsx /Users/adishahaf/Downloads/crm.xlsx \
    --env /Users/adishahaf/Desktop/crm-app/.env.local
"""

from __future__ import annotations

import argparse
import datetime as dt
import decimal
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
DOCREL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

PEOPLE_HEADERS = ("Name", "Services", "מספר טלפון")
SERVICE_HEADERS = ("Services", "Name", "מחיר")

SELLER_EMAIL_BY_NAME = {
    "עדי": "adi@synergytech.co.il",
    "יובל": "yuval@synergytech.co.il",
    "אטיאס": "elattiass@gmail.com",
}

PROJECT_MANAGER_EMAIL_BY_NAME = {
    "עדי שחף": "adi@synergytech.co.il",
    "shai": "shai@synergytech.co.il",
    "יובל כהן": "yuval@synergytech.co.il",
}

PROJECT_STAGE_BY_LEGACY = {
    "עתידי": "future",
    "בעבודה": "in_progress",
    "אושר": "done",
    "תקוע": "future",
}

PROJECT_STATUS_BY_LEGACY = {
    "עתידי": "on_hold",
    "בעבודה": "active",
    "אושר": "done",
    "תקוע": "on_hold",
}

MISSING_COLUMN_RE = re.compile(r"Could not find the '([^']+)' column of '([^']+)'")


def col_to_idx(col: str) -> int:
    value = 0
    for ch in col:
        value = value * 26 + (ord(ch.upper()) - 64)
    return value


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


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


def first_sheet_path(zf: zipfile.ZipFile) -> str:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall("rel:Relationship", NS)}
    sheet = wb.find("main:sheets/main:sheet", NS)
    if sheet is None:
        raise RuntimeError("No sheets found in workbook")
    target = rel_map[sheet.attrib[DOCREL]]
    if target.startswith("/"):
        return target.lstrip("/")
    return target if target.startswith("xl/") else f"xl/{target}"


def sheet_path_by_name(zf: zipfile.ZipFile, sheet_name: str) -> str | None:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall("rel:Relationship", NS)}
    for sheet in wb.findall("main:sheets/main:sheet", NS):
        if sheet.attrib.get("name") == sheet_name:
            target = rel_map[sheet.attrib[DOCREL]]
            if target.startswith("/"):
                return target.lstrip("/")
            return target if target.startswith("xl/") else f"xl/{target}"
    return None


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
    if typ == "b":
        return "TRUE" if raw == "1" else "FALSE"
    return raw


def read_sheet_rows(path: Path, sheet_name: str | None = None) -> list[list[str]]:
    with zipfile.ZipFile(path) as zf:
        shared = parse_shared_strings(zf)
        if sheet_name:
            sheet = sheet_path_by_name(zf, sheet_name)
            if not sheet:
                raise RuntimeError(f"Sheet not found: {sheet_name}")
        else:
            sheet = first_sheet_path(zf)
        root = ET.fromstring(zf.read(sheet))

    rows: list[tuple[int, dict[int, str]]] = []
    max_col = 0
    for row in root.findall("main:sheetData/main:row", NS):
        rnum = int(row.attrib.get("r", "0") or 0)
        values: dict[int, str] = {}
        for cell in row.findall("main:c", NS):
            ref = cell.attrib.get("r", "")
            m = re.match(r"([A-Z]+)(\d+)", ref)
            if not m:
                continue
            idx = col_to_idx(m.group(1))
            values[idx] = excel_cell_value(cell, shared)
            max_col = max(max_col, idx)
        rows.append((rnum, values))

    out: list[list[str]] = []
    for _, value_map in rows:
        row = [value_map.get(i, "").strip() for i in range(1, max_col + 1)]
        out.append(row)
    return out


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return v if v else None


def normalize_legacy_id(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None
    try:
        d = decimal.Decimal(v)
        if d == d.to_integral_value():
            return str(int(d))
    except decimal.InvalidOperation:
        pass
    return v


def normalize_phone(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None

    normalized = normalize_legacy_id(v) or v
    digits = re.sub(r"\D", "", normalized)
    if not digits:
        return None

    # Common Israel lead formats in legacy export:
    # 528851540 -> 0528851540
    # 972522255307 -> 0522255307
    if len(digits) == 9 and digits.startswith("5"):
        return f"0{digits}"
    if len(digits) == 12 and digits.startswith("9725"):
        return f"0{digits[3:]}"
    return digits


def normalize_email(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None
    return v.lower()


def normalize_source(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None
    lower = v.lower()
    if lower in {"tiktok", "tik tok"}:
        return "tiktok"
    if lower in {"ig", "instagram"}:
        return "ig"
    if lower in {"fb", "facebook"}:
        return "fb"
    return v


def parse_score(value: str | None) -> int | None:
    v = clean_text(value)
    if not v:
        return None
    try:
        score = int(float(v))
    except ValueError:
        return None
    if score < 1 or score > 3:
        return None
    return score


def parse_money(value: str | None) -> float | None:
    v = clean_text(value)
    if not v:
        return None
    try:
        return float(v.replace(",", ""))
    except ValueError:
        return None


def parse_person_datetime(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None
    if "YYYY-" in v:
        return None

    as_excel = excel_serial_to_datetime(v)
    if as_excel:
        return as_excel

    iso_candidate = v.replace(" ", "T")
    try:
        parsed = dt.datetime.fromisoformat(iso_candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).isoformat()


def excel_serial_to_datetime(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None
    try:
        serial = float(v)
    except ValueError:
        return None
    epoch = dt.datetime(1899, 12, 30, tzinfo=dt.timezone.utc)
    parsed = epoch + dt.timedelta(days=serial)
    if abs(serial - round(serial)) < 1e-9:
        return parsed.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    return parsed.replace(microsecond=0).isoformat()


def excel_serial_to_date(value: str | None) -> str | None:
    value_dt = excel_serial_to_datetime(value)
    if not value_dt:
        return None
    return value_dt[:10]


def map_seller_email(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None
    return SELLER_EMAIL_BY_NAME.get(v)


def map_project_manager_email(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None
    return PROJECT_MANAGER_EMAIL_BY_NAME.get(v)


def normalize_project_fields(value: str | None) -> tuple[str, str | None]:
    v = clean_text(value)
    if not v:
        return "future", None
    stage = PROJECT_STAGE_BY_LEGACY.get(v, "future")
    project_status = PROJECT_STATUS_BY_LEGACY.get(v)
    return stage, project_status


def parse_comment_created_at(value: str | None) -> str | None:
    v = clean_text(value)
    if not v:
        return None

    # Example: 29/May/2025 01:30:11 PM
    for fmt in ("%d/%b/%Y %I:%M:%S %p", "%d/%B/%Y %I:%M:%S %p"):
        try:
            parsed = dt.datetime.strptime(v, fmt)
            parsed = parsed.replace(tzinfo=ZoneInfo("Asia/Jerusalem"))
            return parsed.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat()
        except ValueError:
            continue

    try:
        parsed = dt.datetime.fromisoformat(v.replace(" ", "T"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo("Asia/Jerusalem"))
        return parsed.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat()
    except ValueError:
        return None


def is_blank_row(row: list[str]) -> bool:
    return all(not cell.strip() for cell in row)


def nonempty_count(row: list[str]) -> int:
    return sum(1 for cell in row if cell.strip())


def is_people_header(row: list[str]) -> bool:
    return len(row) >= 3 and tuple(row[:3]) == PEOPLE_HEADERS


def is_service_header(row: list[str]) -> bool:
    return len(row) >= 3 and tuple(row[:3]) == SERVICE_HEADERS


@dataclass
class ParsedData:
    people: list[dict[str, Any]]
    notes: list[dict[str, Any]]
    services: list[dict[str, Any]]
    unknown_sellers: Counter
    unknown_project_managers: Counter
    ignored_rows: int


@dataclass
class ParsedSheetComments:
    notes: list[dict[str, Any]]
    rows_with_content: int


def parse_legacy_rows_atias(rows: list[list[str]]) -> ParsedData:
    people: list[dict[str, Any]] = []
    notes: list[dict[str, Any]] = []
    services: list[dict[str, Any]] = []
    unknown_sellers: Counter = Counter()
    unknown_pm: Counter = Counter()
    ignored_rows = 0

    header_idx: dict[str, int] | None = None
    current_group: str | None = None

    for row in rows:
        if not header_idx:
            if "Name" in row and "Item ID (auto generated)" in row:
                header_idx = {value.strip(): index for index, value in enumerate(row) if value.strip()}
            elif clean_text(row[0]) and nonempty_count(row) == 1:
                current_group = row[0].strip()
            continue

        # pad for safe index access
        row = row + [""] * 32
        if is_blank_row(row):
            continue

        # group marker row
        if clean_text(row[0]) and nonempty_count(row) == 1:
            current_group = row[0].strip()
            continue

        # repeated header row
        if clean_text(row[0]) == "Name" and "Item ID (auto generated)" in row:
            continue

        name = clean_text(row[header_idx.get("Name", 0)])
        if not name:
            ignored_rows += 1
            continue

        external_idx = header_idx.get("Item ID (auto generated)")
        external_id = normalize_legacy_id(row[external_idx]) if external_idx is not None else None
        if not external_id:
            external_id = f"legacy_row_{len(people) + 1}"

        seller_idx = header_idx.get("מוכר")
        seller_raw = clean_text(row[seller_idx]) if seller_idx is not None else None
        seller_email = map_seller_email(seller_raw)
        if seller_raw and not seller_email:
            unknown_sellers[seller_raw] += 1

        def get(col_name: str) -> str | None:
            idx = header_idx.get(col_name)
            if idx is None:
                return None
            return clean_text(row[idx])

        person: dict[str, Any] = {
            "external_source_id": external_id,
            "full_name": name,
            "phone": normalize_phone(get("מספר טלפון")),
            "email": normalize_email(get("כתובת מייל")),
            "sheet_datetime": parse_person_datetime(get("תאריך ושעה")),
            "score_1_3": parse_score(get("ציון 1-3")),
            "source": normalize_source(get("מקור")),
            "whatsapp_response": get("תגובה להודעת ווטסאפ"),
            "employment_status": get("שכיר / עצמאי"),
            "lead_idea": get("רעיון (טופס לידים)"),
            "seller": seller_email,
            "campaign": get("קמפיין"),
            "ad_name": get("שם המודעה"),
            "total_contracts": None,
            "status": get("סטטוס"),
            "_group_name": current_group,
        }

        people.append(person)

        # Keep legacy H-like behavior: add note from whatsapp response when present.
        if person["whatsapp_response"]:
            notes.append(
                {
                    "person_external_source_id": external_id,
                    "type": "note",
                    "content": person["whatsapp_response"],
                }
            )

    return ParsedData(
        people=people,
        notes=notes,
        services=services,
        unknown_sellers=unknown_sellers,
        unknown_project_managers=unknown_pm,
        ignored_rows=ignored_rows,
    )


def parse_legacy_rows(rows: list[list[str]]) -> ParsedData:
    people: list[dict[str, Any]] = []
    notes: list[dict[str, Any]] = []
    services: list[dict[str, Any]] = []
    unknown_sellers: Counter = Counter()
    unknown_pm: Counter = Counter()
    ignored_rows = 0

    current_group: str | None = None
    current_person_external_id: str | None = None

    for row in rows:
        row = row + [""] * max(0, 16 - len(row))
        if is_blank_row(row):
            continue

        if is_people_header(row) or is_service_header(row):
            continue

        # Group section marker (single value row).
        if clean_text(row[0]) and nonempty_count(row) == 1:
            current_group = row[0].strip()
            current_person_external_id = None
            continue

        # Service row under the most recent person.
        if not clean_text(row[0]) and clean_text(row[1]) and current_person_external_id:
            service_legacy_id = normalize_legacy_id(row[10])
            stage, project_status = normalize_project_fields(row[5])
            pm_email = map_project_manager_email(row[9])
            if clean_text(row[9]) and not pm_email:
                unknown_pm[row[9].strip()] += 1

            installment_plan = clean_text(row[4])
            services.append(
                {
                    "person_external_source_id": current_person_external_id,
                    "service_id": clean_text(row[1]),
                    "price": parse_money(row[2]),
                    "payment_method": clean_text(row[3]),
                    "installment_plan": installment_plan,
                    "payment_status": "pending",
                    "project_status": project_status,
                    "project_stage": stage,
                    "sale_date": excel_serial_to_date(row[6]),
                    "project_start_date": excel_serial_to_date(row[7]),
                    "project_finish_date": excel_serial_to_date(row[8]),
                    "project_manager": pm_email,
                    "legacy_item_id": service_legacy_id,
                }
            )
            continue

        # Person row.
        if clean_text(row[0]) and row[0] not in {"Name", "Services"}:
            external_id = normalize_legacy_id(row[15])
            if not external_id:
                # Fallback to a deterministic ID if legacy ID is missing.
                external_id = f"legacy_row_{len(people) + 1}"

            seller_email = map_seller_email(row[10])
            if clean_text(row[10]) and not seller_email:
                unknown_sellers[row[10].strip()] += 1

            person: dict[str, Any] = {
                "external_source_id": external_id,
                "full_name": clean_text(row[0]) or "Unknown",
                "phone": normalize_phone(row[2]),
                "email": normalize_email(row[3]),
                "sheet_datetime": parse_person_datetime(row[4]),
                "score_1_3": parse_score(row[5]),
                "source": normalize_source(row[6]),
                "whatsapp_response": clean_text(row[7]),
                "employment_status": clean_text(row[8]),
                "lead_idea": clean_text(row[9]),
                "seller": seller_email,
                "campaign": clean_text(row[11]),
                "ad_name": clean_text(row[12]),
                "total_contracts": parse_money(row[13]),
                "status": clean_text(row[14]),
                "_group_name": current_group,
            }

            people.append(person)
            current_person_external_id = external_id

            # H column goes to comments.
            if clean_text(row[7]):
                notes.append(
                    {
                        "person_external_source_id": external_id,
                        "type": "note",
                        "content": row[7].strip(),
                    }
                )
            continue

        ignored_rows += 1

    return ParsedData(
        people=people,
        notes=notes,
        services=services,
        unknown_sellers=unknown_sellers,
        unknown_project_managers=unknown_pm,
        ignored_rows=ignored_rows,
    )


def parse_comments_sheet_rows(rows: list[list[str]]) -> ParsedSheetComments:
    # Sheet columns:
    # A Item ID, B Item Name, C Content Type, D Content Type, E User, F Created At,
    # G Update Content, H Likes Count, I Asset IDs, J Post ID, K Parent Post ID
    notes: list[dict[str, Any]] = []
    rows_with_content = 0
    for row in rows[1:]:
        row = row + [""] * max(0, 11 - len(row))
        content = clean_text(row[6])
        if not content:
            continue
        rows_with_content += 1
        notes.append(
            {
                "person_external_source_id": normalize_legacy_id(row[0]),
                "person_name": clean_text(row[1]),
                "type": "note",
                "content": content,
                "created_by_name": clean_text(row[4]),
                "created_at": parse_comment_created_at(row[5]),
                "source_post_id": normalize_legacy_id(row[9]),
            }
        )
    return ParsedSheetComments(notes=notes, rows_with_content=rows_with_content)


class SupabaseRest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = f"{supabase_url.rstrip('/')}/rest/v1"
        self.service_role_key = service_role_key

    def _request(
        self,
        method: str,
        path: str,
        query: str = "",
        body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        url = f"{self.base}{path}{query}"
        payload = None
        req_headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
        }
        if headers:
            req_headers.update(headers)

        if body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            req_headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url=url, data=payload, method=method, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                status = resp.getcode()
                raw = resp.read()
        except urllib.error.HTTPError as err:
            raw = err.read()
            message = raw.decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {err.code} {path}{query}: {message}") from err

        if not raw:
            return status, None

        text = raw.decode("utf-8", errors="replace")
        try:
            return status, json.loads(text)
        except json.JSONDecodeError:
            return status, text

    def get(self, path: str, query: str = "", headers: dict[str, str] | None = None) -> Any:
        _, data = self._request("GET", path, query=query, headers=headers)
        return data

    def post(
        self, path: str, body: Any, query: str = "", headers: dict[str, str] | None = None
    ) -> Any:
        _, data = self._request("POST", path, query=query, body=body, headers=headers)
        return data


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def extract_missing_column(error_text: str) -> tuple[str, str] | None:
    m = MISSING_COLUMN_RE.search(error_text)
    if not m:
        return None
    col, table = m.group(1), m.group(2)
    return col, table


def fetch_all_rows(api: SupabaseRest, table: str, select: str, page_size: int = 1000) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for start in range(0, 1_000_000_000, page_size):
        data = api.get(
            f"/{table}",
            query=f"?select={urllib.parse.quote(select, safe='*,()')}",
            headers={"Range": f"{start}-{start + page_size - 1}"},
        )
        if not data:
            break
        rows.extend(data)
        if len(data) < page_size:
            break
    return rows


def fetch_groups_by_name(api: SupabaseRest) -> dict[str, str]:
    rows = api.get("/groups", query="?select=id,name")
    out: dict[str, str] = {}
    for row in rows or []:
        name = row.get("name")
        gid = row.get("id")
        if name and gid:
            out[name] = gid
    return out


def import_people(api: SupabaseRest, people: list[dict[str, Any]]) -> tuple[dict[str, str], list[str]]:
    person_id_by_external: dict[str, str] = {}
    dropped_columns: set[str] = set()

    for batch in chunked(people, 200):
        while True:
            payload = [{k: v for k, v in row.items() if k not in dropped_columns} for row in batch]
            try:
                inserted = api.post(
                    "/people",
                    body=payload,
                    query="?on_conflict=external_source_id",
                    headers={"Prefer": "resolution=merge-duplicates,return=representation"},
                )
                for row in inserted or []:
                    ext = row.get("external_source_id")
                    pid = row.get("id")
                    if ext and pid:
                        person_id_by_external[str(ext)] = str(pid)
                break
            except RuntimeError as err:
                missing = extract_missing_column(str(err))
                if not missing:
                    raise
                col, table = missing
                if table != "people":
                    raise
                dropped_columns.add(col)

    return person_id_by_external, sorted(dropped_columns)


def import_notes(api: SupabaseRest, notes: list[dict[str, Any]]) -> tuple[int, list[str]]:
    if not notes:
        return 0, []

    inserted_count = 0
    dropped_columns: set[str] = set()
    for batch in chunked(notes, 400):
        while True:
            payload = []
            for note in batch:
                row = dict(note)
                if not clean_text(row.get("created_by_name")):
                    row["created_by_name"] = "Legacy Import"
                row.setdefault("created_at", None)
                row = {k: v for k, v in row.items() if k not in dropped_columns}
                payload.append(row)
            try:
                api.post("/notes", body=payload, headers={"Prefer": "return=minimal"})
                break
            except RuntimeError as err:
                missing = extract_missing_column(str(err))
                if not missing:
                    raise
                col, table = missing
                if table != "notes":
                    raise
                dropped_columns.add(col)
        inserted_count += len(batch)
    return inserted_count, sorted(dropped_columns)


def import_services(api: SupabaseRest, services: list[dict[str, Any]]) -> tuple[int, bool, list[str]]:
    if not services:
        return 0, False, []

    inserted_count = 0
    legacy_column_missing = False
    dropped_columns: set[str] = set()
    for batch in chunked(services, 300):
        while True:
            payload = []
            for source_row in batch:
                row = {k: v for k, v in source_row.items() if k not in dropped_columns}
                if "legacy_item_id" in dropped_columns:
                    legacy_id = source_row.get("legacy_item_id")
                    if legacy_id:
                        marker = f"legacy_item_id:{legacy_id}"
                        if "installment_plan" not in dropped_columns:
                            existing_plan = clean_text(row.get("installment_plan"))
                            row["installment_plan"] = (
                                f"{existing_plan} | {marker}" if existing_plan else marker
                            )
                        else:
                            existing_service = clean_text(row.get("service_id")) or "Service"
                            row["service_id"] = f"{existing_service} [{marker}]"
                payload.append(row)

            try:
                api.post("/purchases", body=payload, headers={"Prefer": "return=minimal"})
                break
            except RuntimeError as err:
                missing = extract_missing_column(str(err))
                if not missing:
                    raise
                col, table = missing
                if table != "purchases":
                    raise
                dropped_columns.add(col)
                if col == "legacy_item_id":
                    legacy_column_missing = True
        inserted_count += len(batch)
    return inserted_count, legacy_column_missing, sorted(dropped_columns)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True, type=Path)
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--items-sheet-name")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only-notes", action="store_true")
    parser.add_argument("--dedupe-notes", action="store_true")
    parser.add_argument("--notes-from-comments-sheet", action="store_true")
    parser.add_argument("--comments-sheet-name", default="תגובות")
    args = parser.parse_args()

    env = parse_env_file(args.env)
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env file")

    rows = read_sheet_rows(args.xlsx, sheet_name=args.items_sheet_name)
    use_atias_parser = bool(args.items_sheet_name and args.items_sheet_name.strip() == "אטיאס")
    parsed = parse_legacy_rows_atias(rows) if use_atias_parser else parse_legacy_rows(rows)

    print("Parsed:")
    print(f"- people: {len(parsed.people)}")
    print(f"- notes (H only): {len(parsed.notes)}")
    print(f"- services: {len(parsed.services)}")
    print(f"- ignored rows: {parsed.ignored_rows}")
    if parsed.unknown_sellers:
        print(f"- unknown sellers: {dict(parsed.unknown_sellers)}")
    if parsed.unknown_project_managers:
        print(f"- unknown project managers: {dict(parsed.unknown_project_managers)}")

    if args.dry_run:
        if args.notes_from_comments_sheet:
            comment_rows = read_sheet_rows(args.xlsx, sheet_name=args.comments_sheet_name)
            parsed_comment_sheet = parse_comments_sheet_rows(comment_rows)
            print(f"- comments sheet '{args.comments_sheet_name}' with content rows: {parsed_comment_sheet.rows_with_content}")
        return

    api = SupabaseRest(supabase_url=supabase_url, service_role_key=service_key)

    if args.only_notes:
        all_people = fetch_all_rows(api, "people", "id,external_source_id,full_name")
        person_id_by_external: dict[str, str] = {}
        people_by_name: dict[str, list[str]] = defaultdict(list)
        for row in all_people:
            ext = clean_text(row.get("external_source_id"))
            pid = clean_text(row.get("id"))
            if ext and pid:
                person_id_by_external[ext] = pid
            name = clean_text(row.get("full_name"))
            if name and pid:
                people_by_name[name.lower()].append(pid)

        note_source = parsed.notes
        if args.notes_from_comments_sheet:
            comment_rows = read_sheet_rows(args.xlsx, sheet_name=args.comments_sheet_name)
            note_source = parse_comments_sheet_rows(comment_rows).notes

        prepared_notes: list[dict[str, Any]] = []
        missing_note_people = 0
        matched_by_name = 0
        ambiguous_name = 0
        for note in note_source:
            ext = note["person_external_source_id"]
            person_id = person_id_by_external.get(ext)
            if not person_id and args.notes_from_comments_sheet:
                person_name = clean_text(note.get("person_name"))
                if person_name:
                    matches = people_by_name.get(person_name.lower(), [])
                    if len(matches) == 1:
                        person_id = matches[0]
                        matched_by_name += 1
                    elif len(matches) > 1:
                        ambiguous_name += 1
            if not person_id:
                missing_note_people += 1
                continue
            row = {
                "person_id": person_id,
                "type": note["type"],
                "content": note["content"],
            }
            if clean_text(note.get("created_by_name")):
                row["created_by_name"] = note["created_by_name"].strip()
            if clean_text(note.get("created_at")):
                row["created_at"] = note["created_at"].strip()
            prepared_notes.append(row)

        skipped_existing = 0
        if args.dedupe_notes:
            existing_note_rows = fetch_all_rows(api, "notes", "person_id,content,created_at")
            existing_set = set()
            for row in existing_note_rows:
                pid = clean_text(row.get("person_id")) or ""
                content = clean_text(row.get("content")) or ""
                created_at = clean_text(row.get("created_at")) or ""
                existing_set.add((pid, content, created_at[:19]))
            unique_notes: list[dict[str, Any]] = []
            seen_in_batch: set[tuple[str, str, str]] = set()
            for note in prepared_notes:
                note_created_at = clean_text(note.get("created_at")) or ""
                key = (note["person_id"], note["content"].strip(), note_created_at[:19])
                if key in existing_set or key in seen_in_batch:
                    skipped_existing += 1
                    continue
                seen_in_batch.add(key)
                unique_notes.append(note)
            prepared_notes = unique_notes

        inserted_notes, dropped_note_columns = import_notes(api, prepared_notes)
        print("\nImported (notes only):")
        print(f"- notes inserted: {inserted_notes}")
        print(f"- notes skipped (missing person): {missing_note_people}")
        if args.notes_from_comments_sheet:
            print(f"- notes matched by unique name fallback: {matched_by_name}")
            print(f"- notes skipped (ambiguous duplicate names): {ambiguous_name}")
        if args.dedupe_notes:
            print(f"- notes skipped (already existed): {skipped_existing}")
        if dropped_note_columns:
            print(f"- note columns not present in DB (skipped): {', '.join(dropped_note_columns)}")
        return

    groups_by_name = fetch_groups_by_name(api)
    default_group_id = groups_by_name.get("לידים")
    if not default_group_id:
        raise SystemExit("Could not find group 'לידים' in DB")

    prepared_people: list[dict[str, Any]] = []
    for person in parsed.people:
        group_name = person.pop("_group_name", None)
        group_id = groups_by_name.get(group_name or "", default_group_id)
        row = dict(person)
        row["group_id"] = group_id
        prepared_people.append(row)

    person_ids_by_external, dropped_people_columns = import_people(api, prepared_people)

    prepared_notes: list[dict[str, Any]] = []
    missing_note_people = 0
    for note in parsed.notes:
        ext = note["person_external_source_id"]
        person_id = person_ids_by_external.get(ext)
        if not person_id:
            missing_note_people += 1
            continue
        prepared_notes.append(
            {
                "person_id": person_id,
                "type": note["type"],
                "content": note["content"],
            }
        )

    prepared_services: list[dict[str, Any]] = []
    missing_service_people = 0
    for service in parsed.services:
        ext = service["person_external_source_id"]
        person_id = person_ids_by_external.get(ext)
        if not person_id:
            missing_service_people += 1
            continue

        row = dict(service)
        row.pop("person_external_source_id", None)
        row["person_id"] = person_id
        prepared_services.append(row)

    inserted_notes, dropped_note_columns = import_notes(api, prepared_notes)
    inserted_services, used_legacy_fallback, dropped_purchase_columns = import_services(
        api, prepared_services
    )

    print("\nImported:")
    print(f"- people: {len(prepared_people)}")
    print(f"- notes: {inserted_notes}")
    print(f"- services: {inserted_services}")
    print(f"- notes skipped (missing person): {missing_note_people}")
    print(f"- services skipped (missing person): {missing_service_people}")
    if used_legacy_fallback:
        print(
            "- legacy_item_id column missing in DB: legacy IDs were appended to installment_plan/service_id"
        )
    else:
        print("- legacy_item_id saved in purchases.legacy_item_id")
    if dropped_people_columns:
        print(f"- people columns not present in DB (skipped): {', '.join(dropped_people_columns)}")
    if dropped_note_columns:
        print(f"- note columns not present in DB (skipped): {', '.join(dropped_note_columns)}")
    if dropped_purchase_columns:
        print(f"- purchase columns not present in DB (skipped): {', '.join(dropped_purchase_columns)}")


if __name__ == "__main__":
    main()
