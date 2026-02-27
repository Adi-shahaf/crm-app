import zipfile
import xml.etree.ElementTree as ET
import re

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
DOCREL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

def col_to_idx(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n

def excel_cell_value(cell, shared):
    typ = cell.attrib.get("t")
    v_node = cell.find("main:v", NS)
    if v_node is None:
        inline = cell.find("main:is/main:t", NS)
        return (inline.text or "").strip() if inline is not None else ""
    raw = (v_node.text or "").strip()
    if typ == "s":
        try:
            return shared[int(raw)].strip()
        except:
            return raw
    return raw

import sys
import codecs
sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

def inspect(path):
    with zipfile.ZipFile(path) as zf:
        try:
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            shared = []
            for si in root.findall("main:si", NS):
                t = si.find("main:t", NS)
                if t is not None:
                    shared.append(t.text or "")
                else:
                    shared.append("".join((x.text or "") for x in si.findall(".//main:t", NS)))
        except KeyError:
            shared = []
            
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall("rel:Relationship", NS)}
        
        for sheet in wb.findall("main:sheets/main:sheet", NS):
            sheet_name = sheet.attrib.get("name")
            target = rel_map[sheet.attrib[DOCREL]]
            if target.startswith("/"):
                target = target.lstrip("/")
            else:
                target = target if target.startswith("xl/") else f"xl/{target}"
            print(f"Sheet: {sheet_name}")
            
            root = ET.fromstring(zf.read(target))
            rows = []
            max_col = 0
            count = 0
            for row in root.findall("main:sheetData/main:row", NS):
                if count > 5: break
                count += 1
                values = {}
                for cell in row.findall("main:c", NS):
                    ref = cell.attrib.get("r", "")
                    m = re.match(r"([A-Z]+)(\d+)", ref)
                    if not m: continue
                    idx = col_to_idx(m.group(1))
                    values[idx] = excel_cell_value(cell, shared)
                    max_col = max(max_col, idx)
                rows.append([values.get(i, "").strip() for i in range(1, max_col + 1)])
            for r in rows:
                print(r)
            print("-" * 50)

inspect(r"c:\Users\adish\Downloads\_-_1772216866.xlsx")
