#!/usr/bin/env python3
"""Reproduce BodyBuilder's pinned, complete USDA SR Legacy food catalogue.

No API key, Python packages, manual nutrition values, or macro-derived calories
are used. The official archive's exact SHA-256 must match before parsing.
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import tempfile
import unicodedata
import urllib.request
import zipfile


ARCHIVE_URL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
ARCHIVE_SHA256 = "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0"
ARCHIVE_BYTES = 6_074_592
RELEASE = "SR Legacy April 2018"
PREFIX = "FoodData_Central_sr_legacy_food_csv_2018-04/"
IMPORTER_VERSION = "usda-sr-legacy-v1"
CATALOGUE_NAME = "usda-sr-legacy-2018-04.json"
MANIFEST_NAME = "usda-sr-legacy-2018-04.manifest.json"
NUTRIENTS = {
    "1008": ("calories", "Energy", "KCAL", 1000),
    "1003": ("protein", "Protein", "G", 100),
    "1005": ("carbs", "Carbohydrate, by difference", "G", 100),
    "1004": ("fat", "Total lipid (fat)", "G", 100),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source(fdc_id: str) -> str:
    return f"USDA FoodData Central · {RELEASE} · FDC {fdc_id} · CC0-1.0 · {ARCHIVE_URL}"


def normalize(food: dict[str, str], amounts: dict[str, str]) -> tuple[dict | None, str | None]:
    """Keep only complete source values; an absent amount is never zero."""
    identifier = food.get("fdc_id", "")
    name = food.get("description", "")
    if food.get("data_type") != "sr_legacy_food":
        return None, "other_data_type"
    if not identifier.isascii() or not identifier.isdigit() or int(identifier) <= 0:
        return None, "invalid_fdc_id"
    if not name.strip() or len(name) > 200 or any(unicodedata.category(c) == "Cc" for c in name):
        return None, "invalid_description"
    record = {"id": f"usda:{identifier}", "name": name, "serving": "100 g", "source": source(identifier)}
    for nutrient_id, (field, _, _, maximum) in NUTRIENTS.items():
        amount = amounts.get(nutrient_id)
        if amount is None or not amount.strip():
            return None, "missing_nutrition"
        try:
            value = float(amount)
        except (ValueError, TypeError):
            return None, "invalid_nutrition"
        if not math.isfinite(value) or not 0 <= value <= maximum:
            return None, "invalid_nutrition"
        record[field] = value
    return record, None


def csv_rows(archive: zipfile.ZipFile, filename: str):
    with archive.open(PREFIX + filename) as source_file:
        yield from csv.DictReader(io.TextIOWrapper(source_file, encoding="utf-8-sig", newline=""))


def import_archive(path: Path) -> tuple[bytes, bytes]:
    content = path.read_bytes()
    if len(content) != ARCHIVE_BYTES or sha256(content) != ARCHIVE_SHA256:
        raise ValueError("USDA archive checksum/size differs from the pinned official release; refusing to import")
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > 80_000_000:
            raise ValueError("USDA archive exceeds the extraction bound")
        definitions = {row["id"]: row for row in csv_rows(archive, "nutrient.csv")}
        for identifier, (_, name, unit, _) in NUTRIENTS.items():
            definition = definitions.get(identifier)
            if definition is None or definition["name"] != name or definition["unit_name"] != unit:
                raise ValueError(f"Nutrient {identifier} does not have the pinned expected name/unit")
        source_foods = list(csv_rows(archive, "food.csv"))
        if len({food["fdc_id"] for food in source_foods}) != len(source_foods):
            raise ValueError("Source food identifiers are not unique")
        values: dict[str, dict[str, str]] = collections.defaultdict(dict)
        conflicting: set[str] = set()
        for row in csv_rows(archive, "food_nutrient.csv"):
            if row["nutrient_id"] not in NUTRIENTS:
                continue
            stored = values[row["fdc_id"]]
            if row["nutrient_id"] in stored and stored[row["nutrient_id"]] != row["amount"]:
                conflicting.add(row["fdc_id"])
            stored[row["nutrient_id"]] = row["amount"]
        foods = []
        skipped: collections.Counter = collections.Counter()
        for food in source_foods:
            if food["fdc_id"] in conflicting:
                skipped["ambiguous_nutrition"] += 1
                continue
            normalized, reason = normalize(food, values.get(food["fdc_id"], {}))
            if normalized is None:
                skipped[reason] += 1
            else:
                foods.append(normalized)
        foods.sort(key=lambda record: int(record["id"].split(":", 1)[1]))
        # One compact, readable record per line. No generation timestamp makes
        # both output files byte-for-byte reproducible across repeated imports.
        catalogue = ("[\n" + ",\n".join(json.dumps(food, ensure_ascii=False, separators=(",", ":"), allow_nan=False) for food in foods) + "\n]\n").encode("utf-8")
        manifest = {
            "schemaVersion": 1,
            "importerVersion": IMPORTER_VERSION,
            "dataset": "USDA FoodData Central SR Legacy",
            "release": RELEASE,
            "releaseDate": "2018-04",
            "foodPublicationDates": sorted({food["publication_date"] for food in source_foods}),
            "downloadURL": ARCHIVE_URL,
            "downloadPageURL": "https://fdc.nal.usda.gov/download-datasets/",
            "fieldDefinitionsURL": "https://fdc.nal.usda.gov/docs/Download_Field_Descriptions_Oct2020.pdf",
            "license": "CC0-1.0",
            "licenseURL": "https://creativecommons.org/publicdomain/zero/1.0/",
            "licenseEvidenceURL": "https://fdc.nal.usda.gov/api-guide/",
            "archiveSha256": ARCHIVE_SHA256,
            "archiveBytes": ARCHIVE_BYTES,
            "catalogueSha256": sha256(catalogue),
            "sourceRecordCount": len(source_foods),
            "recordCount": len(foods),
            "skippedRecords": dict(sorted(skipped.items())),
            "serving": "100 g",
            "nutrients": [{"field": field, "id": int(identifier), "name": name, "unit": unit} for identifier, (field, name, unit, _) in NUTRIENTS.items()],
            "selectionPolicy": "All SR Legacy records with unique FDC IDs, valid descriptions, and complete finite nonnegative source Energy(1008,kcal), Protein(1003,g), Carbohydrate by difference(1005,g), Total lipid(1004,g) per100g; no calculated or invented missing values",
            "members": [{"name": filename, "sha256": sha256(archive.read(PREFIX + filename))} for filename in ("food.csv", "food_nutrient.csv", "nutrient.csv")],
        }
        return catalogue, (json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def download(path: Path):
    request = urllib.request.Request(ARCHIVE_URL, headers={"User-Agent": "BodyBuilder USDA Importer/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response, path.open("wb") as destination:
        total = 0
        while chunk := response.read(64 * 1024):
            total += len(chunk)
            if total > 16_000_000:
                raise ValueError("USDA download exceeds the size bound")
            destination.write(chunk)


def self_test():
    food = {"fdc_id": "123456", "data_type": "sr_legacy_food", "description": "Importer self-test fixture"}
    complete = {"1008": "100", "1003": "1", "1005": "20", "1004": "0"}
    normalized, reason = normalize(food, complete)
    assert reason is None and normalized["fat"] == 0 and normalized["serving"] == "100 g"
    for missing in ("1008", "1003", "1005", "1004"):
        partial = {key: value for key, value in complete.items() if key != missing}
        assert normalize(food, partial)[0] is None, "missing nutrient became zero"
    for bad in ("", " ", "NaN", "Infinity", "-1", "1001", "unknown", "<0.5"):
        invalid = dict(complete, **{"1008": bad})
        assert normalize(food, invalid)[0] is None, "invalid nutrient was accepted"
    assert normalize(dict(food, description=""), complete)[0] is None
    assert normalize(dict(food, data_type="branded_food"), complete)[0] is None
    print("Importer self-tests passed (explicit zero, four missing fields, eight invalid amounts, invalid text/type)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="use an already downloaded official ZIP (checksum still required)")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "backend/providers/data")
    parser.add_argument("--check", action="store_true", help="reproduce and compare existing files without writing")
    parser.add_argument("--self-test", action="store_true", help="run importer validation tests without downloading")
    arguments = parser.parse_args()
    if arguments.self_test:
        self_test()
        return
    with tempfile.TemporaryDirectory(prefix="bodybuilder-usda-") as temporary:
        archive = arguments.archive or Path(temporary) / "source.zip"
        if arguments.archive is None:
            download(archive)
        catalogue, manifest = import_archive(archive)
    if arguments.check:
        for name, expected in ((CATALOGUE_NAME, catalogue), (MANIFEST_NAME, manifest)):
            if (arguments.output_dir / name).read_bytes() != expected:
                raise ValueError(f"{name} differs from reproducible pinned source output")
    else:
        arguments.output_dir.mkdir(parents=True, exist_ok=True)
        (arguments.output_dir / CATALOGUE_NAME).write_bytes(catalogue)
        (arguments.output_dir / MANIFEST_NAME).write_bytes(manifest)
    metadata = json.loads(manifest)
    print(json.dumps({"verified": True, "release": RELEASE, "records": metadata["recordCount"], "skipped": metadata["skippedRecords"], "archiveSha256": ARCHIVE_SHA256, "catalogueSha256": metadata["catalogueSha256"], "mode": "check" if arguments.check else "write"}))


if __name__ == "__main__":
    main()
