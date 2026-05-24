# RSA Phase Winner Maps

Static GitHub Pages viewer for categorical RSA phase winner NIfTI maps.

## Run Locally

From this directory:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

The app uses only static files and browser APIs. It must be served over HTTP because browsers block `fetch()` from local `file://` pages.

## Publish On GitHub Pages

1. Create a GitHub repository.
2. Commit this folder's contents.
3. In the repository settings, enable GitHub Pages for the main branch root.

No build step is required.

## Assets

The bundled assets are in `assets/`:

- `assets/template/MNI152_T1_2mm.nii.gz`
- `assets/maps/*.nii.gz`
- `assets/manifest.json`
- `assets/winner_code_lookup.csv`

`tools/build_assets.py` regenerates the compressed assets and manifest from the local analysis folder.

## Label Semantics

Label `0` is not significant and is always transparent in the overlay. Labels `1..10` are rendered as discrete categorical colors from the manifest/codebook.
