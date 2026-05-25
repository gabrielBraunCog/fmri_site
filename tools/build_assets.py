import gzip
import json
import shutil
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\Gabriel\Desktop\reAnalysis_RSA_DIM\RSA_phase_mantel_winner_vectors")
TEMPLATE_SOURCE = Path(
    r"E:\26_05_24_parcellized_dataframe\sub_cortical_combined\isc_scores\p_values\niftis\mni_icbm152_t1_tal_nlin_asym_09a_brain.nii.gz"
)

MAP_SOURCES = [
    ("belief_computer", SOURCE / "belief_computer" / "belief_computer.nii"),
    ("belief_computer_org", SOURCE / "belief_computer_org" / "computer_org.nii"),
    ("belief_couples", SOURCE / "belief_couples" / "belief_couples.nii"),
    ("belief_fire", SOURCE / "belief_fire" / "belief_fire.nii"),
    ("belief_fraud_comp", SOURCE / "belief_fraud_comp" / "belief_fraud_comp.nii"),
    ("belief_storage", SOURCE / "belief_storage" / "belief_storage.nii"),
]

LABELS = [
    {"code": 0, "originalSignedCode": 0, "model": "none", "sign": "not_significant", "name": "Not significant", "color": "#000000"},
    {"code": 1, "originalSignedCode": -1, "model": "fdist", "sign": "negative", "name": "fdist negative", "color": "#3366cc"},
    {"code": 2, "originalSignedCode": 1, "model": "fdist", "sign": "positive", "name": "fdist positive", "color": "#dc3912"},
    {"code": 3, "originalSignedCode": -2, "model": "fmean_belief", "sign": "negative", "name": "fmean_belief negative", "color": "#3bb3e8"},
    {"code": 4, "originalSignedCode": 2, "model": "fmean_belief", "sign": "positive", "name": "fmean_belief positive", "color": "#ff5257"},
    {"code": 5, "originalSignedCode": -3, "model": "fextremity", "sign": "negative", "name": "fextremity negative", "color": "#10485d"},
    {"code": 6, "originalSignedCode": 3, "model": "fextremity", "sign": "positive", "name": "fextremity positive", "color": "#7f2020"},
    {"code": 7, "originalSignedCode": -4, "model": "fside", "sign": "negative", "name": "fside negative", "color": "#dd4477"},
    {"code": 8, "originalSignedCode": 4, "model": "fside", "sign": "positive", "name": "fside positive", "color": "#66aa00"},
    {"code": 9, "originalSignedCode": -5, "model": "f3cat", "sign": "negative", "name": "f3cat negative", "color": "#b82e2e"},
    {"code": 10, "originalSignedCode": 5, "model": "f3cat", "sign": "positive", "name": "f3cat positive", "color": "#316395"},
]


def read_bytes(path):
    if path.suffix == ".gz":
        with gzip.open(path, "rb") as src:
            return src.read()
    return path.read_bytes()


def nifti_header(raw):
    header = raw[:348]
    endian = "<" if struct.unpack("<i", header[:4])[0] == 348 else ">"
    dim = struct.unpack(endian + "8h", header[40:56])
    pixdim = struct.unpack(endian + "8f", header[76:108])
    datatype = struct.unpack(endian + "h", header[70:72])[0]
    bitpix = struct.unpack(endian + "h", header[72:74])[0]
    vox_offset = int(struct.unpack(endian + "f", header[108:112])[0])
    return {
        "endian": endian,
        "dimensions": [dim[1], dim[2], dim[3]],
        "pixdim": [round(pixdim[1], 4), round(pixdim[2], 4), round(pixdim[3], 4)],
        "datatype": datatype,
        "bitpix": bitpix,
        "voxOffset": vox_offset,
    }


def float32_values(raw, header):
    count = header["dimensions"][0] * header["dimensions"][1] * header["dimensions"][2]
    start = header["voxOffset"]
    return struct.unpack(header["endian"] + f"{count}f", raw[start : start + count * 4])


def write_gzip(raw, destination):
    with gzip.GzipFile(filename="", mode="wb", fileobj=destination.open("wb"), mtime=0) as out:
        out.write(raw)


def main():
    maps_dir = ROOT / "assets" / "maps"
    template_dir = ROOT / "assets" / "template"
    maps_dir.mkdir(parents=True, exist_ok=True)
    template_dir.mkdir(parents=True, exist_ok=True)

    template_raw = read_bytes(TEMPLATE_SOURCE)
    template_header = nifti_header(template_raw)
    write_gzip(template_raw, template_dir / "MNI152_T1_2mm.nii.gz")

    maps = []
    for key, source_path in MAP_SOURCES:
        raw = read_bytes(source_path)
        header = nifti_header(raw)
        values = float32_values(raw, header)
        unique_labels = sorted({int(round(value)) for value in values})
        nonzero_voxels = sum(1 for value in values if value != 0)
        output_name = f"{key}.nii.gz"
        write_gzip(raw, maps_dir / output_name)
        maps.append(
            {
                "id": key,
                "name": key.replace("_", " ").title(),
                "url": f"assets/maps/{output_name}",
                "sourceFile": str(source_path),
                "dimensions": header["dimensions"],
                "pixdim": header["pixdim"],
                "datatype": header["datatype"],
                "uniqueLabels": unique_labels,
                "nonzeroVoxels": nonzero_voxels,
            }
        )

    shutil.copy2(SOURCE / "winner_code_lookup.csv", ROOT / "assets" / "winner_code_lookup.csv")

    manifest = {
        "template": {
            "name": "MNI ICBM152 2009a brain 1mm",
            "url": "assets/template/MNI152_T1_2mm.nii.gz",
            "sourceFile": str(TEMPLATE_SOURCE),
            "dimensions": template_header["dimensions"],
            "pixdim": template_header["pixdim"],
            "datatype": template_header["datatype"],
        },
        "labels": LABELS,
        "maps": maps,
    }
    (ROOT / "assets" / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(maps)} maps and manifest to {ROOT / 'assets'}")


if __name__ == "__main__":
    main()
